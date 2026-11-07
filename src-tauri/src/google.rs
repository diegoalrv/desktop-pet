//! "Iniciar sesión con Google" (Calendar y Gmail, solo lectura): OAuth 2.0 de app de escritorio con PKCE y redirect
//! loopback (`http://127.0.0.1:<puerto>`), en el navegador del sistema. Sin backend: el refresh token vive en
//! `<app_data>/google.json` y el access token solo en memoria. Pasos para crear el cliente: GOOGLE_OAUTH.md.
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

const AUTH: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN: &str = "https://oauth2.googleapis.com/token";
const REVOKE: &str = "https://oauth2.googleapis.com/revoke";
const CAL: &str = "https://www.googleapis.com/calendar/v3";
const GMAIL: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
// gmail.readonly y no gmail.metadata: metadata es "cabeceras sin cuerpo" (el snippet no está garantizado) y no acepta
// `q`. Las dos son "restringidas" (mismo trámite de verificación), así que metadata no ahorraba nada.
const SCOPES: &str = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly";
const LOGIN_WAIT: Duration = Duration::from_secs(300);
const SOME_ACCOUNT: &str = "tu cuenta de Google"; // si no se supo el mail; nunca "" (en prefs.google = sin conectar)
const EXPIRED: &str = "La sesión de Google venció o se revocó: vuelve a conectar en Ajustes → Conexiones";

/// Cliente OAuth "App de escritorio". En apps instaladas el secret no es secreto (Google lo documenta así);
/// van en el binario al compilar (`GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… pnpm tauri build`) o, en dev, del entorno.
fn client() -> Option<(String, String)> {
    let get = |built: Option<&str>, name: &str| {
        built.map(str::to_string).filter(|s| !s.is_empty()).or_else(|| std::env::var(name).ok().filter(|s| !s.is_empty()))
    };
    let id = get(option_env!("GOOGLE_CLIENT_ID"), "GOOGLE_CLIENT_ID")?;
    let secret = get(option_env!("GOOGLE_CLIENT_SECRET"), "GOOGLE_CLIENT_SECRET").unwrap_or_default();
    Some((id, secret))
}

#[derive(Serialize, Deserialize)]
struct Session {
    refresh_token: String,
    email: String,
}

/// Access token vigente (sirve ~1 h); se pide otro con el refresh token al vencer.
static ACCESS: Mutex<Option<(String, Instant)>> = Mutex::new(None);

// ponytail: refresh token en un archivo 0600 en app_data (como el token de la web); al keychain/Credential Manager
// (crate `keyring`) si algún día hace falta que otro proceso del usuario no pueda leerlo.
fn session_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    Some(app.path().app_data_dir().ok()?.join("google.json"))
}

fn load(app: &AppHandle) -> Option<Session> {
    serde_json::from_slice(&std::fs::read(session_path(app)?).ok()?).ok()
}

fn save(app: &AppHandle, s: &Session) -> Result<(), String> {
    let path = session_path(app).ok_or("sin carpeta de datos")?;
    let _ = std::fs::create_dir_all(path.parent().unwrap());
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
    use std::io::Write;
    opts.open(path).and_then(|mut f| f.write_all(&serde_json::to_vec(s).unwrap())).map_err(|e| e.to_string())
}

fn forget(app: &AppHandle) {
    *ACCESS.lock().unwrap() = None;
    if let Some(p) = session_path(app) {
        let _ = std::fs::remove_file(p);
    }
    let _ = app.emit("google://changed", ()); // Ajustes deja de mostrar "Conectado como…"
}

pub fn connected(app: &AppHandle) -> bool {
    load(app).is_some()
}

// --- PKCE y URLs ---

/// Percent-encoding de RFC 3986 (todo menos los no reservados).
fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn dec(s: &str) -> String {
    let b = s.as_bytes();
    let hex = |i: usize| b.get(i).and_then(|&c| (c as char).to_digit(16));
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match (b[i], hex(i + 1), hex(i + 2)) {
            (b'%', Some(h), Some(l)) => {
                out.push((h * 16 + l) as u8);
                i += 2;
            }
            (b'+', ..) => out.push(b' '),
            (c, ..) => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn form(pairs: &[(&str, &str)]) -> String {
    pairs.iter().map(|(k, v)| format!("{k}={}", enc(v))).collect::<Vec<_>>().join("&")
}

/// base64url sin relleno (RFC 4648 §5), lo que pide PKCE.
fn b64url(data: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..=c.len() {
            out.push(A[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}

/// Verifier al azar (2 UUID v4 = 244 bits del RNG del SO, 64 caracteres hex: dentro de 43..128) y su challenge S256.
fn pkce() -> (String, String) {
    let v = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
    let c = challenge(&v);
    (v, c)
}

fn challenge(verifier: &str) -> String {
    use sha2::{Digest, Sha256};
    b64url(&Sha256::digest(verifier.as_bytes()))
}

fn auth_url(client_id: &str, redirect: &str, challenge: &str, state: &str) -> String {
    let q = form(&[
        ("client_id", client_id),
        ("redirect_uri", redirect),
        ("response_type", "code"),
        ("scope", SCOPES),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("state", state),
        ("access_type", "offline"), // refresh token
        ("prompt", "consent"),       // que vuelva a darlo al reconectar
    ]);
    format!("{AUTH}?{q}")
}

/// `code` de la vuelta del navegador (`/?state=…&code=…`), validando `state`; `None` si es otro pedido (favicon…).
fn parse_callback(url: &str, state: &str) -> Option<Result<String, String>> {
    let q = url.split_once('?')?.1;
    let get = |k: &str| q.split('&').find_map(|p| p.strip_prefix(k)?.strip_prefix('=')).map(dec);
    if let Some(e) = get("error") {
        return Some(Err(if e == "access_denied" { "Cancelaste el acceso en Google".into() } else { format!("Google: {e}") }));
    }
    let code = get("code")?;
    Some(if get("state").as_deref() == Some(state) { Ok(code) } else { Err("respuesta de Google inválida (state)".into()) })
}

/// Abre el navegador del sistema. En Windows sin `cmd /C start`: los `&` de la URL cortarían el comando.
fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    let r = crate::cmd("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn();
    #[cfg(not(windows))]
    let r = std::process::Command::new("open").arg(url).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

// --- HTTP ---

fn agent_cfg<B>(r: ureq::RequestBuilder<B>) -> ureq::RequestBuilder<B> {
    r.config().timeout_global(Some(Duration::from_secs(20))).http_status_as_error(false).build()
}

fn read(mut res: ureq::http::Response<ureq::Body>) -> Result<(u16, Value), String> {
    let status = res.status().as_u16();
    let text = res.body_mut().read_to_string().map_err(|e| e.to_string())?;
    Ok((status, serde_json::from_str(&text).unwrap_or(Value::String(text))))
}

fn post_form(url: &str, pairs: &[(&str, &str)]) -> Result<(u16, Value), String> {
    let res = agent_cfg(ureq::post(url))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .send(form(pairs))
        .map_err(|_| "sin conexión con Google".to_string())?;
    read(res)
}

/// Mensaje de error de una respuesta de Google (`error.message` de las APIs o `error_description` de OAuth).
fn google_err(v: &Value) -> String {
    v["error"]["message"].as_str().or(v["error_description"].as_str()).or(v["error"].as_str()).unwrap_or("error").to_string()
}

fn api_get(app: &AppHandle, url: &str) -> Result<Value, String> {
    let token = access_token(app)?;
    let res = agent_cfg(ureq::get(url))
        .header("Authorization", format!("Bearer {token}"))
        .call()
        .map_err(|_| "sin conexión con Google".to_string())?;
    match read(res)? {
        (200, v) => Ok(v),
        (401, _) => {
            *ACCESS.lock().unwrap() = None; // el próximo pedido refresca
            Err("Google rechazó el token; reintenta".into())
        }
        (403, v) => Err(format!("Google sin permiso: {} (desconecta y vuelve a conectar marcando el acceso)", google_err(&v))),
        (s, v) => Err(format!("Google {s}: {}", google_err(&v))),
    }
}

fn access_token(app: &AppHandle) -> Result<String, String> {
    if let Some((t, exp)) = ACCESS.lock().unwrap().as_ref() {
        if Instant::now() < *exp {
            return Ok(t.clone());
        }
    }
    let s = load(app).ok_or("Google no está conectado")?;
    let (id, secret) = client().ok_or("falta GOOGLE_CLIENT_ID")?;
    let (status, v) = post_form(
        TOKEN,
        &[("client_id", &id), ("client_secret", &secret), ("refresh_token", &s.refresh_token), ("grant_type", "refresh_token")],
    )?;
    if status != 200 {
        // invalid_grant: revocado o vencido (en modo Testing Google los vence a los 7 días)
        if v["error"] == "invalid_grant" {
            forget(app);
            return Err(EXPIRED.into());
        }
        return Err(format!("Google: {}", google_err(&v)));
    }
    cache(&v)
}

/// Guarda el access token de una respuesta del endpoint de token (60 s de margen).
fn cache(v: &Value) -> Result<String, String> {
    let t = v["access_token"].as_str().ok_or("Google no devolvió access_token")?.to_string();
    let secs = v["expires_in"].as_u64().unwrap_or(3600).saturating_sub(60);
    *ACCESS.lock().unwrap() = Some((t.clone(), Instant::now() + Duration::from_secs(secs)));
    Ok(t)
}

// --- Login ---

fn login(app: &AppHandle) -> Result<String, String> {
    let (id, secret) = client().ok_or("Falta configurar el cliente OAuth de Google (GOOGLE_CLIENT_ID, ver GOOGLE_OAUTH.md)")?;
    // Puerto al azar en loopback: los clientes "App de escritorio" aceptan cualquiera sin registrarlo.
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = server.server_addr().to_ip().ok_or("sin puerto")?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let (verifier, ch) = pkce();
    let state = uuid::Uuid::new_v4().simple().to_string();
    open_browser(&auth_url(&id, &redirect, &ch, &state))?;

    let deadline = Instant::now() + LOGIN_WAIT;
    let code = loop {
        let left = deadline.saturating_duration_since(Instant::now());
        let Ok(Some(req)) = server.recv_timeout(left) else { return Err("Se acabó el tiempo para iniciar sesión en Google".into()) };
        let Some(r) = parse_callback(req.url(), &state) else {
            let _ = req.respond(tiny_http::Response::empty(404));
            continue;
        };
        let msg = if r.is_ok() { "Listo: Candola quedó conectada a Google. Ya puedes cerrar esta pestaña." } else { "No se pudo conectar con Google. Vuelve a la app e inténtalo de nuevo." };
        let html = format!("<!doctype html><meta charset=utf-8><title>Candola</title><body style=\"font:16px system-ui;margin:3em\">{msg}");
        let _ = req.respond(
            tiny_http::Response::from_string(html)
                .with_header(tiny_http::Header::from_bytes("Content-Type", "text/html; charset=utf-8").unwrap()),
        );
        break r?;
    };

    let (status, v) = post_form(
        TOKEN,
        &[
            ("client_id", &id),
            ("client_secret", &secret),
            ("code", &code),
            ("code_verifier", &verifier),
            ("redirect_uri", &redirect),
            ("grant_type", "authorization_code"),
        ],
    )?;
    if status != 200 {
        return Err(format!("Google: {}", google_err(&v)));
    }
    let refresh = v["refresh_token"].as_str().ok_or("Google no devolvió refresh token")?.to_string();
    cache(&v)?;
    // Guarda antes de pedir el mail: api_get lee la sesión si el access token venciera.
    save(app, &Session { refresh_token: refresh.clone(), email: SOME_ACCOUNT.into() })?;
    // El mail sale del perfil de Gmail; si no se dio ese permiso (consentimiento por casillas), del calendario principal.
    let email = api_get(app, &format!("{GMAIL}/profile"))
        .ok()
        .and_then(|p| p["emailAddress"].as_str().map(str::to_string))
        .or_else(|| api_get(app, &format!("{CAL}/calendars/primary")).ok().and_then(|c| c["id"].as_str().map(str::to_string)))
        .unwrap_or_else(|| SOME_ACCOUNT.into());
    save(app, &Session { refresh_token: refresh, email: email.clone() })?;
    Ok(email)
}

#[derive(Serialize)]
pub struct Status {
    configured: bool, // hay client_id compilado
    email: Option<String>, // conectado como…
}

#[tauri::command]
pub fn google_status(app: AppHandle) -> Status {
    Status { configured: client().is_some(), email: load(&app).map(|s| s.email) }
}

/// Abre el navegador y espera (hasta 5 min) a que el usuario autorice; devuelve el mail de la cuenta.
#[tauri::command]
pub async fn google_connect(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || login(&app))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| crate::errors::failure("google", "login", e))
}

/// Revoca el token en Google (si hay red) y borra la sesión local.
#[tauri::command]
pub async fn google_disconnect(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(s) = load(&app) {
            let _ = post_form(REVOKE, &[("token", &s.refresh_token)]);
        }
        forget(&app);
    })
    .await
    .map_err(|e| e.to_string())
}

// --- Calendar ---

#[derive(Deserialize, Default)]
#[serde(default)]
struct When {
    #[serde(rename = "dateTime")]
    date_time: Option<String>,
    date: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Attendee {
    email: String,
    #[serde(rename = "displayName")]
    display_name: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Event {
    id: String,
    status: String,
    summary: String,
    description: String,
    start: When,
    end: When,
    attendees: Vec<Attendee>,
}

/// Texto de iCal (RFC 5545 §3.3.11).
fn ics_text(s: &str) -> String {
    s.replace('\\', "\\\\").replace(';', "\\;").replace(',', "\\,").replace("\r\n", "\\n").replace('\n', "\\n")
}

/// `DTSTART:20261106T150000Z` (hora a UTC) o `DTSTART;VALUE=DATE:20261106` (día completo).
fn ics_when(prop: &str, w: &When) -> Option<String> {
    if let Some(dt) = &w.date_time {
        let t = chrono::DateTime::parse_from_rfc3339(dt).ok()?.with_timezone(&chrono::Utc);
        return Some(format!("{prop}:{}", t.format("%Y%m%dT%H%M%SZ")));
    }
    Some(format!("{prop};VALUE=DATE:{}", w.date.as_ref()?.replace('-', "")))
}

/// Eventos de la Calendar API (`singleEvents=true`: series ya expandidas) como un .ics: así `lib/calendar.ts`,
/// la web y las reuniones siguen leyendo lo mismo que con la URL secreta.
fn events_to_ics(v: &Value) -> String {
    let events: Vec<Event> = serde_json::from_value(v["items"].clone()).unwrap_or_default();
    let mut out = String::from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//SpadeLab//Candola//ES\r\n");
    for e in events {
        let (Some(start), Some(end)) = (ics_when("DTSTART", &e.start), ics_when("DTEND", &e.end)) else { continue };
        out += "BEGIN:VEVENT\r\n";
        out += &format!("UID:{}\r\n{start}\r\n{end}\r\nSUMMARY:{}\r\n", e.id, ics_text(&e.summary));
        if !e.description.is_empty() {
            out += &format!("DESCRIPTION:{}\r\n", ics_text(&e.description));
        }
        if e.status == "cancelled" {
            out += "STATUS:CANCELLED\r\n";
        }
        for a in &e.attendees {
            let cn = a.display_name.replace(['"', ';', ':', ','], " ");
            let cn = if cn.trim().is_empty() { String::new() } else { format!(";CN=\"{}\"", cn.trim()) };
            out += &format!("ATTENDEE{cn}:mailto:{}\r\n", a.email);
        }
        out += "END:VEVENT\r\n";
    }
    out + "END:VCALENDAR\r\n"
}

/// Calendario principal de ayer a pasado mañana como .ics (cubre el aviso de las próximas 24 h y la reunión en curso).
/// ponytail: una sola página (250 eventos en 3 días); `nextPageToken` si alguien llega a tantos.
pub fn calendar_ics(app: &AppHandle) -> Result<String, String> {
    let now = chrono::Utc::now();
    let iso = |t: chrono::DateTime<chrono::Utc>| enc(&t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
    let url = format!(
        "{CAL}/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin={}&timeMax={}",
        iso(now - chrono::Duration::days(1)),
        iso(now + chrono::Duration::days(2)),
    );
    api_get(app, &url).map(|v| events_to_ics(&v))
}

// --- Gmail ---

#[derive(Serialize, Debug, PartialEq)]
pub struct Mail {
    id: String,
    from: String,
    subject: String,
    snippet: String,
    date: i64, // ms epoch
    unread: bool,
}

/// El snippet de Gmail viene con entidades HTML.
fn unescape(s: &str) -> String {
    s.replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

fn parse_mail(v: &Value) -> Mail {
    let header = |name: &str| {
        v["payload"]["headers"]
            .as_array()
            .and_then(|hs| hs.iter().find(|h| h["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(name))))
            .and_then(|h| h["value"].as_str())
            .unwrap_or_default()
            .to_string()
    };
    Mail {
        id: v["id"].as_str().unwrap_or_default().into(),
        from: header("From"),
        subject: header("Subject"),
        snippet: unescape(v["snippet"].as_str().unwrap_or_default()),
        date: v["internalDate"].as_str().and_then(|d| d.parse().ok()).unwrap_or(0),
        unread: v["labelIds"].as_array().is_some_and(|ls| ls.iter().any(|l| l == "UNREAD")),
    }
}

/// Últimos `max` correos de la bandeja de entrada (solo los no leídos con `unread`): remitente, asunto y snippet.
/// ponytail: un GET por correo (máx. 25); el endpoint batch de Gmail si algún día se piden muchos.
#[tauri::command]
pub async fn gmail_recent(app: AppHandle, max: Option<u32>, unread: Option<bool>) -> Result<Vec<Mail>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let n = max.unwrap_or(10).clamp(1, 25);
        let filter = if unread.unwrap_or(false) { "&labelIds=UNREAD" } else { "" };
        let list = api_get(&app, &format!("{GMAIL}/messages?maxResults={n}&labelIds=INBOX{filter}"))?;
        let ids = list["messages"].as_array().cloned().unwrap_or_default();
        ids.iter()
            .filter_map(|m| m["id"].as_str())
            .map(|id| {
                let url = format!("{GMAIL}/messages/{id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject");
                api_get(&app, &url).map(|v| parse_mail(&v))
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pkce_vector_rfc7636() {
        // RFC 7636, apéndice B
        assert_eq!(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        let (v, c) = pkce();
        assert_eq!(v.len(), 64);
        assert!(v.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(c, challenge(&v));
        assert_ne!(pkce().0, v);
    }

    #[test]
    fn base64url_sin_relleno() {
        assert_eq!(b64url(b""), "");
        assert_eq!(b64url(b"f"), "Zg");
        assert_eq!(b64url(b"fo"), "Zm8");
        assert_eq!(b64url(b"foo"), "Zm9v");
        assert_eq!(b64url(b"foob"), "Zm9vYg");
        assert_eq!(b64url(&[0xfb, 0xff]), "-_8");
    }

    #[test]
    fn url_de_autorizacion() {
        let u = auth_url("123.apps.googleusercontent.com", "http://127.0.0.1:5123", "CH-_", "st");
        assert!(u.starts_with("https://accounts.google.com/o/oauth2/v2/auth?client_id=123.apps.googleusercontent.com&"));
        assert!(u.contains("&redirect_uri=http%3A%2F%2F127.0.0.1%3A5123&"));
        assert!(u.contains("&response_type=code&"));
        assert!(u.contains(
            "&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly&"
        ));
        assert!(u.contains("&code_challenge=CH-_&code_challenge_method=S256&state=st&access_type=offline&prompt=consent"));
    }

    #[test]
    fn vuelta_del_navegador() {
        assert_eq!(parse_callback("/?state=abc&code=4%2F0Ade-x&scope=a+b", "abc"), Some(Ok("4/0Ade-x".into())));
        assert!(matches!(parse_callback("/?state=otro&code=x", "abc"), Some(Err(_))));
        assert_eq!(parse_callback("/?error=access_denied&state=abc", "abc"), Some(Err("Cancelaste el acceso en Google".into())));
        assert_eq!(parse_callback("/favicon.ico", "abc"), None);
        assert_eq!(dec("a%20b+c%zz%4"), "a b c%zz%4");
    }

    #[test]
    fn calendar_a_ics() {
        let v = json!({"items": [
            {"id": "ev1_20261106T150000Z", "status": "confirmed", "summary": "Daily, equipo; sync",
             "description": "Línea 1\nLínea 2",
             "start": {"dateTime": "2026-11-06T12:00:00-03:00", "timeZone": "America/Santiago"},
             "end": {"dateTime": "2026-11-06T12:30:00-03:00"},
             "attendees": [{"email": "ana@x.com", "displayName": "Ana \"A\" Pérez"}, {"email": "bob@x.com", "self": true}]},
            {"id": "feriado", "summary": "Feriado", "start": {"date": "2026-11-07"}, "end": {"date": "2026-11-08"}},
            {"id": "cancelada", "status": "cancelled", "start": {"dateTime": "2026-11-06T18:00:00Z"}, "end": {"dateTime": "2026-11-06T19:00:00Z"}},
            {"id": "sin-fechas", "status": "cancelled"}
        ]});
        let ics = events_to_ics(&v);
        assert!(ics.starts_with("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
        assert!(ics.ends_with("END:VCALENDAR\r\n"));
        assert!(ics.contains("UID:ev1_20261106T150000Z\r\nDTSTART:20261106T150000Z\r\nDTEND:20261106T153000Z\r\n"));
        assert!(ics.contains("SUMMARY:Daily\\, equipo\\; sync\r\n"));
        assert!(ics.contains("DESCRIPTION:Línea 1\\nLínea 2\r\n"));
        assert!(ics.contains("ATTENDEE;CN=\"Ana  A  Pérez\":mailto:ana@x.com\r\n"));
        assert!(ics.contains("ATTENDEE:mailto:bob@x.com\r\n"));
        assert!(ics.contains("DTSTART;VALUE=DATE:20261107\r\nDTEND;VALUE=DATE:20261108\r\n"));
        assert!(ics.contains("UID:cancelada\r\nDTSTART:20261106T180000Z\r\nDTEND:20261106T190000Z\r\nSUMMARY:\r\nSTATUS:CANCELLED\r\n"));
        assert!(!ics.contains("sin-fechas"));
        assert_eq!(events_to_ics(&json!({})), "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//SpadeLab//Candola//ES\r\nEND:VCALENDAR\r\n");
    }

    #[test]
    fn gmail_mensaje() {
        let v = json!({
            "id": "18c1", "threadId": "18c1", "labelIds": ["UNREAD", "INBOX"],
            "snippet": "Hola, te mando el informe &amp; los n&#39;meros",
            "internalDate": "1762444800000",
            "payload": {"headers": [
                {"name": "Subject", "value": "Informe semanal"},
                {"name": "from", "value": "Ana Pérez <ana@x.com>"}
            ]}
        });
        assert_eq!(
            parse_mail(&v),
            Mail {
                id: "18c1".into(),
                from: "Ana Pérez <ana@x.com>".into(),
                subject: "Informe semanal".into(),
                snippet: "Hola, te mando el informe & los n'meros".into(),
                date: 1762444800000,
                unread: true,
            }
        );
        let leido = parse_mail(&json!({"id": "1", "labelIds": ["INBOX"]}));
        assert!(!leido.unread && leido.subject.is_empty() && leido.date == 0);
    }

    #[test]
    fn errores_de_google() {
        assert_eq!(google_err(&json!({"error": {"code": 403, "message": "Insufficient Permission"}})), "Insufficient Permission");
        assert_eq!(google_err(&json!({"error": "invalid_grant", "error_description": "Token has been expired or revoked."})), "Token has been expired or revoked.");
    }
}
