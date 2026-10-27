//! IA por el proxy propio (F19): en Windows una sola "Key de Candola" (Ajustes) reemplaza la cadena de modelos y
//! todo va a ai.spadelab.xyz (LiteLLM). En Mac nada cambia, salvo que se arranque con `PET_AI=candola` para probar
//! el flujo de Windows.
use crate::meeting::Llm;
use std::time::Duration;
use tauri::AppHandle;

/// Mismo destino que `meeting::base_url("candola")`.
const PROXY: &str = "https://ai.spadelab.xyz/v1";

/// ¿La IA va por el proxy? Windows siempre; en otro sistema solo con `PET_AI=candola`.
fn proxy_mode() -> bool {
    cfg!(windows) || std::env::var("PET_AI").is_ok_and(|v| v == "candola")
}

fn candola_key(app: &AppHandle) -> String {
    use tauri_plugin_store::StoreExt;
    let prefs = app.store("settings.json").ok().and_then(|s| s.get("prefs")).unwrap_or_default();
    prefs["candolaKey"].as_str().unwrap_or("").trim().to_string()
}

/// En modo proxy, solo el alias `candola` con la key (vacía = el error "falta la API key"); si no, la cadena tal cual.
fn chain(proxy: bool, key: String, llms: Vec<Llm>) -> Vec<Llm> {
    if proxy {
        vec![Llm { provider: "candola".into(), apikey: key, models: vec!["candola".into()] }]
    } else {
        llms
    }
}

pub const NO_KEY: &str = "Pega tu key de Candola en Ajustes → Asistente.";
pub const OFFLINE: &str = "No pude conectar con el servidor de la Candola. Revisa tu internet.";

/// Error del proxy en palabras del tester (los casos los da LiteLLM, o Traefik con 404 si no llegó key).
pub fn friendly(status: u16, body: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    match (status, v["error"]["type"].as_str().unwrap_or("")) {
        (404, _) => NO_KEY.into(),
        (401, _) => "Tu key de Candola no es válida. Revísala en Ajustes → Asistente o pide una nueva a Spadelab.".into(),
        (_, "budget_exceeded") => "Se acabó tu cuota de IA de este mes. Se renueva sola; si la necesitas antes, escríbele a Spadelab.".into(),
        (403, _) => "Tu key de Candola no tiene acceso a esto. Avísale a Spadelab.".into(),
        (429, _) => "Muchas consultas seguidas: espera un minuto y vuelve a intentar.".into(),
        (s, _) => format!("La Candola no pudo responder ({s}). Intenta de nuevo en un rato."),
    }
}

/// Key de Candola si la IA va por el proxy (vacía si no la han pegado: el proxy la rechaza); `None` = flujo de Mac.
pub fn proxy_key(app: &AppHandle) -> Option<String> {
    proxy_mode().then(|| candola_key(app))
}

/// La cadena de modelos que de verdad se usa: reuniones, gestión y preguntas pasan por aquí.
pub fn llms(app: &AppHandle, llms: Vec<Llm>) -> Vec<Llm> {
    match proxy_key(app) {
        Some(key) => chain(true, key, llms),
        None => llms,
    }
}

/// Un turno del chat de Windows (`src/lib/candolaChat.ts` lleva el bucle de herramientas): `messages` y `tools` en
/// formato OpenAI al alias `candola`; devuelve el `message` de la respuesta (texto y/o `tool_calls`).
#[tauri::command]
pub async fn ai_chat(app: AppHandle, messages: serde_json::Value, tools: serde_json::Value) -> Result<serde_json::Value, String> {
    let key = proxy_key(&app).ok_or("el chat por el proxy es solo para el modo Windows")?;
    if key.is_empty() {
        return Err(NO_KEY.into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let body = serde_json::json!({"model": "candola", "messages": messages, "tools": tools});
        let mut res = ureq::post(format!("{PROXY}/chat/completions"))
            .config()
            .timeout_global(Some(Duration::from_secs(180)))
            .http_status_as_error(false)
            .build()
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {key}"))
            .send(body.to_string())
            .map_err(|_| OFFLINE.to_string())?;
        let status = res.status().as_u16();
        let text = res.body_mut().read_to_string().map_err(|e| e.to_string())?;
        if status != 200 {
            return Err(friendly(status, &text));
        }
        let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        Ok(v["choices"][0]["message"].clone())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Embeddings por el proxy (`/embeddings`, formato OpenAI, todos los textos en una llamada).
pub fn embed(key: &str, model: &str, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    if key.is_empty() {
        return Err(NO_KEY.into());
    }
    let mut res = ureq::post(format!("{PROXY}/embeddings"))
        .config()
        .timeout_global(Some(Duration::from_secs(120)))
        .http_status_as_error(false)
        .build()
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {key}"))
        .send(serde_json::json!({"model": model, "input": texts}).to_string())
        .map_err(|_| OFFLINE.to_string())?;
    let status = res.status().as_u16();
    let text = res.body_mut().read_to_string().map_err(|e| e.to_string())?;
    if status != 200 {
        return Err(friendly(status, &text));
    }
    parse_embeddings(&serde_json::from_str(&text).unwrap_or_default())
}

/// Los vectores de `data` en el orden de entrada (cada uno trae su `index`).
fn parse_embeddings(v: &serde_json::Value) -> Result<Vec<Vec<f32>>, String> {
    let mut data: Vec<(u64, Vec<f32>)> = v["data"]
        .as_array()
        .ok_or("respuesta sin embeddings")?
        .iter()
        .map(|d| Ok((d["index"].as_u64().unwrap_or(0), serde_json::from_value(d["embedding"].clone()).map_err(|_| "embedding inválido")?)))
        .collect::<Result<_, &str>>()?;
    data.sort_by_key(|(i, _)| *i);
    Ok(data.into_iter().map(|(_, e)| e).collect())
}

/// Para Ajustes: muestra solo el campo de la key en vez del editor de modelos.
#[tauri::command]
pub fn ai_proxy() -> bool {
    proxy_mode()
}

/// Botón "Probar" de Ajustes: la key abre `/models` del proxy.
#[tauri::command]
pub async fn ai_check(key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut res = ureq::get(format!("{PROXY}/models"))
            .config()
            .timeout_global(Some(Duration::from_secs(20)))
            .http_status_as_error(false)
            .build()
            .header("Authorization", format!("Bearer {}", key.trim()))
            .call()
            .map_err(|_| OFFLINE.to_string())?;
        match res.status().as_u16() {
            200 => Ok(()),
            401 | 404 => Err("Key inválida".into()), // sin key el proxy responde 404
            s => Err(friendly(s, &res.body_mut().read_to_string().unwrap_or_default())),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn en_modo_proxy_solo_va_candola() {
        let mac = vec![Llm { provider: "claude-code".into(), apikey: "".into(), models: vec!["sonnet".into()] }];
        let c = chain(true, "sk-x".into(), mac.clone());
        assert_eq!((c.len(), c[0].provider.as_str(), c[0].apikey.as_str(), c[0].models[0].as_str()), (1, "candola", "sk-x", "candola"));
        let c = chain(false, "sk-x".into(), mac);
        assert_eq!((c.len(), c[0].provider.as_str(), c[0].apikey.as_str()), (1, "claude-code", "")); // Mac: intacta
    }

    #[test]
    fn errores_en_palabras_del_tester() {
        // Cuerpos reales del proxy (LiteLLM), recortados.
        let budget = r#"{"error":{"message":"Budget has been exceeded!","type":"budget_exceeded","code":"422"}}"#;
        let model = r#"{"error":{"message":"not available for this API key","type":"key_model_access_denied","code":"403"}}"#;
        let rpm = r#"{"error":{"message":"Rate limit exceeded","type":"throttling_error","code":"429"}}"#;
        assert_eq!(friendly(404, r#"{"detail":"Not Found"}"#), NO_KEY);
        assert!(friendly(401, "{}").contains("no es válida"));
        assert!(friendly(422, budget).contains("cuota"));
        assert!(friendly(403, model).contains("no tiene acceso"));
        assert!(friendly(429, rpm).contains("espera un minuto"));
        assert!(friendly(502, "<html>").contains("(502)"));
    }

    #[test]
    fn embeddings_en_el_orden_de_entrada() {
        let v = serde_json::json!({"data": [{"index": 1, "embedding": [0.5]}, {"index": 0, "embedding": [1.0, 2.0]}]});
        assert_eq!(parse_embeddings(&v), Ok(vec![vec![1.0, 2.0], vec![0.5]]));
        assert!(parse_embeddings(&serde_json::json!({"error": "x"})).is_err());
        assert!(parse_embeddings(&serde_json::json!({"data": [{"index": 0, "embedding": "x"}]})).is_err());
    }

    /// Contra el proxy de verdad: `CANDOLA_KEY=sk-… cargo test --lib embed_por_el_proxy -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn embed_por_el_proxy() {
        let key = std::env::var("CANDOLA_KEY").expect("CANDOLA_KEY");
        let v = embed(&key, "titan-embed-v2", &["Diego manda la propuesta a Colbún".into(), "sprites del pug".into()]).unwrap();
        println!("{} vectores de {}", v.len(), v[0].len());
        assert_eq!((v.len(), v[0].len()), (2, 1024));
        assert!(embed("sk-falsa", "titan-embed-v2", &["x".into()]).unwrap_err().contains("no es válida"));
    }
}
