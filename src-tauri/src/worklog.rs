//! Trabajo con Claude: a qué proyecto fue tu atención (según tus mensajes en Claude Code y Cowork), cuánto trabajó
//! Claude y cuánto de eso fue desatendido, qué modelos y cuántos tokens se usaron, y qué dejó git (commits, líneas y
//! features que llegaron a main/master). Dos salidas: `collect` para un foco y `hours` para el registro por hora.
//! Todo sale de archivos locales: `~/.claude/projects` (Code) y `local-agent-mode-sessions` (Cowork). Los chats de
//! claude.ai viven en el servidor y no se ven.
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use chrono::{DateTime, SecondsFormat};
use serde_json::Value;

/// ponytail: tope fijo; pasados 10 min desde tu último mensaje a Claude el rato queda sin atribuir.
pub const CAP_MS: i64 = 10 * 60 * 1000;
/// Claude sigue trabajando mientras su sesión escribe algo al menos cada 3 min (respuestas, herramientas).
pub const GAP_MS: i64 = 3 * 60 * 1000;
/// ponytail: horas en epoch UTC; coinciden con las locales en zonas de hora entera (Chile sí).
pub const HOUR_MS: i64 = 3600 * 1000;

#[derive(Debug, Clone)]
pub struct Prompt {
    pub ts: i64,
    pub project: String,
    pub title: String,
}

#[derive(Default, Debug, Clone, PartialEq)]
pub struct Tokens {
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
}

impl Tokens {
    fn add(&mut self, t: &Tokens) {
        (self.input, self.output, self.cache_read, self.cache_write) =
            (self.input + t.input, self.output + t.output, self.cache_read + t.cache_read, self.cache_write + t.cache_write);
    }
    pub fn total(&self) -> i64 {
        self.input + self.output + self.cache_read + self.cache_write
    }
}

#[derive(Default, Debug)]
pub struct ProjectWork {
    pub secs: i64,
    pub detail: String, // títulos de las sesiones de Claude, de más a menos tiempo
    pub commits: i64,
    pub added: i64,
    pub removed: i64,
    pub features: i64,
}

#[derive(Default, Debug)]
pub struct Work {
    pub projects: HashMap<String, ProjectWork>,
    pub tokens: HashMap<(String, String), Tokens>, // (proyecto, modelo)
}

/// Una hora de un proyecto. Tiempos en ms.
#[derive(Default, Debug, Clone, PartialEq)]
pub struct Hour {
    pub you: i64,        // tu atención (mismo reparto que en el foco)
    pub claude: i64,     // Claude trabajando
    pub unattended: i64, // Claude trabajando sin tu atención en ese proyecto
    pub commits: i64,
    pub unattended_commits: i64,
    pub added: i64,
    pub removed: i64,
    pub features: i64,
}

#[derive(Default, Debug)]
pub struct Hours {
    pub work: HashMap<(i64, String), Hour>,                     // (hora, proyecto)
    pub tokens: HashMap<(i64, String, String), (Tokens, i64)>, // (hora, proyecto, modelo) → (uso, tokens desatendidos)
    pub titles: HashMap<(i64, String, String), (i64, i64)>,    // (hora, proyecto, sesión de Claude) → (tu ms, ms de Claude)
    pub projects: Vec<(String, String, String)>,               // (proyecto, carpeta, remoto de git)
}

type Iv = (i64, i64);

/// Tramos de atención: desde cada mensaje tuyo hasta el siguiente (de cualquier proyecto), máx. `CAP_MS`.
fn attention(prompts: &[Prompt]) -> Vec<(Iv, &Prompt)> {
    let mut p: Vec<&Prompt> = prompts.iter().collect();
    p.sort_by_key(|p| p.ts);
    (0..p.len())
        .map(|i| {
            let next = p.get(i + 1).map_or(i64::MAX, |n| n.ts);
            ((p[i].ts, next.min(p[i].ts + CAP_MS)), p[i])
        })
        .filter(|((a, b), _)| b > a)
        .collect()
}

/// Reparte [start, end) entre (proyecto, título) según `attention`.
pub fn attribute(prompts: &[Prompt], start: i64, end: i64) -> HashMap<(String, String), i64> {
    let mut out = HashMap::new();
    for ((a, b), p) in attention(prompts) {
        let (from, to) = (a.max(start), b.min(end));
        if to > from {
            *out.entry((p.project.clone(), p.title.clone())).or_insert(0) += to - from;
        }
    }
    out
}

fn union(mut v: Vec<Iv>) -> Vec<Iv> {
    v.sort();
    let mut out: Vec<Iv> = vec![];
    for (a, b) in v {
        match out.last_mut() {
            Some(l) if a <= l.1 => l.1 = l.1.max(b),
            _ => out.push((a, b)),
        }
    }
    out
}

/// `a` menos `b`, ambos ya unidos y ordenados.
fn minus(a: &[Iv], b: &[Iv]) -> Vec<Iv> {
    let mut out = vec![];
    for &(s0, e) in a {
        let mut s = s0;
        for &(bs, be) in b.iter().filter(|(bs, be)| *be > s0 && *bs < e) {
            if bs > s {
                out.push((s, bs));
            }
            s = s.max(be);
        }
        if e > s {
            out.push((s, e));
        }
    }
    out
}

fn covers(v: &[Iv], t: i64) -> bool {
    let i = v.partition_point(|iv| iv.1 <= t);
    v.get(i).is_some_and(|iv| iv.0 <= t)
}

/// Suma cada tramo a las horas que toca, cortando en los bordes.
fn per_hour(v: &[Iv], mut add: impl FnMut(i64, i64)) {
    for &(mut a, b) in v {
        while a < b {
            let h = a.div_euclid(HOUR_MS) * HOUR_MS;
            let e = b.min(h + HOUR_MS);
            add(h, e - a);
            a = e;
        }
    }
}

/// Tramos en que Claude trabaja: eventos seguidos de una sesión con menos de `GAP_MS` entre uno y otro.
fn runs(ts: &mut [i64]) -> Vec<Iv> {
    ts.sort();
    ts.windows(2).filter(|w| w[1] - w[0] <= GAP_MS && w[1] > w[0]).map(|w| (w[0], w[1])).collect()
}

fn has_tool_result(content: &Value) -> bool {
    content.as_array().is_some_and(|b| b.iter().any(|b| b["type"] == "tool_result"))
}

/// Un mensaje que escribiste tú en Code: sin subagentes, resultados de herramientas ni avisos que inyecta la app
/// de escritorio (esos llegan sin `origin`).
fn human_code(v: &Value) -> bool {
    v["type"] == "user"
        && v["isSidechain"] != true
        && v["isMeta"] != true
        && !has_tool_result(&v["message"]["content"])
        && match v.get("origin") {
            Some(o) => o["kind"] == "human",
            None => v["entrypoint"] != "claude-desktop",
        }
}

fn human_cowork(v: &Value) -> bool {
    v["type"] == "user"
        && v["isSynthetic"] != true
        && v["parent_tool_use_id"].is_null()
        && !has_tool_result(&v["message"]["content"])
}

fn ms(v: &Value) -> Option<i64> {
    DateTime::parse_from_rfc3339(v["timestamp"].as_str()?).ok().map(|d| d.timestamp_millis())
}

fn iso(ms: i64) -> String {
    DateTime::from_timestamp_millis(ms).unwrap_or_default().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let out = crate::cmd("git").arg("-C").arg(dir).args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Carpeta → (raíz del repo, proyecto, ¿git?). Los worktrees cuentan como su repo; sin git, la carpeta misma. El
/// proyecto es la raíz relativa a ~ ("lab/pet", "Documents/U/Curso/Laboratorios"): dos carpetas
/// con el mismo nombre no se mezclan y la ruta dice de qué es (un curso, un cliente).
#[derive(Default)]
struct Roots(HashMap<String, (PathBuf, String, bool)>);

impl Roots {
    fn project(&mut self, dir: &str) -> String {
        if let Some(r) = self.0.get(dir) {
            return r.1.clone();
        }
        let common = git(Path::new(dir), &["rev-parse", "--path-format=absolute", "--git-common-dir"]);
        let (root, is_git) = match common.as_deref().map(str::trim).map(Path::new).and_then(Path::parent) {
            Some(r) => (r.to_path_buf(), true),
            None => (PathBuf::from(dir.split("/.claude/worktrees/").next().unwrap_or(dir)), false),
        };
        let home = crate::home();
        let name = if root == Path::new(&home) {
            "~".to_string()
        } else if root.starts_with(Path::new(&home).join("Library/Application Support/Claude/scratch-workspaces")) {
            "Scratch".to_string() // carpetas temporales de la app de escritorio
        } else {
            root.strip_prefix(&home).unwrap_or(&root).to_string_lossy().into_owned()
        };
        self.0.insert(dir.to_string(), (root, name.clone(), is_git));
        name
    }

    /// Repos con git (uno por raíz) → proyecto.
    fn repos(&self) -> Vec<(PathBuf, String)> {
        let mut seen = HashSet::new();
        self.0.values().filter(|r| r.2 && seen.insert(r.0.clone())).map(|r| (r.0.clone(), r.1.clone())).collect()
    }

    /// (proyecto, carpeta, remoto) de cada proyecto visto; el remoto como "github.com/dueño/repo".
    fn meta(&self) -> Vec<(String, String, String)> {
        let mut seen = HashSet::new();
        self.0
            .values()
            .filter(|r| seen.insert(r.1.clone()))
            .map(|(root, name, is_git)| {
                let url = is_git.then(|| git(root, &["remote", "get-url", "origin"])).flatten().unwrap_or_default();
                (name.clone(), root.to_string_lossy().into_owned(), remote(&url))
            })
            .collect()
    }
}

/// Carpetas sin git que se mudaron a un repo: se unen al repo git que termina en las mismas 3 carpetas, si hay uno
/// solo ("Documents/U/2026-2/ML/Laboratorios" → ".../OneDrive-X/2026-2/ML/Laboratorios"). El repo manda.
/// ponytail: solo ve los repos del rango escaneado; si la carpeta vieja vuelve a usarse sin el repo, queda aparte.
pub fn moved(projects: &[(String, bool)]) -> HashMap<String, String> {
    fn tail(k: &str) -> Vec<&str> {
        k.rsplitn(4, '/').take(3).collect()
    }
    let mut out = HashMap::new();
    for (k, _) in projects.iter().filter(|p| !p.1) {
        let t = tail(k);
        let m: HashSet<&String> = projects.iter().filter(|p| p.1 && t.len() == 3 && tail(&p.0) == t).map(|p| &p.0).collect();
        if let [g] = m.into_iter().collect::<Vec<_>>()[..] {
            out.insert(k.clone(), g.clone());
        }
    }
    out
}

/// "git@github.com:a/b.git" o "https://github.com/a/b.git" → "github.com/a/b".
pub fn remote(url: &str) -> String {
    let u = url.trim().trim_end_matches(".git");
    let u = u.split("://").last().unwrap_or(u);
    let u = u.rsplit('@').next().unwrap_or(u); // usuario o token antes de la @
    u.replacen(':', "/", 1)
}

/// Primera línea de un mensaje tuyo, para nombrar una sesión sin título (sin comandos tipo "<command-name>").
fn first_line(v: &Value) -> Option<String> {
    let c = &v["message"]["content"];
    let t = c.as_str().or_else(|| c.as_array()?.iter().find_map(|b| b["text"].as_str()))?;
    let l = t.trim().lines().next()?.trim();
    (!l.is_empty() && !l.starts_with('<')).then(|| l.chars().take(80).collect())
}


/// Todo lo que pasó en [from, to): tus mensajes (desde `from - CAP_MS`, para el tramo que entra al rango), las
/// respuestas de Claude con su uso y la actividad de cada sesión.
#[derive(Default)]
struct Scan {
    from: i64,
    to: i64,
    prompts: Vec<Prompt>,
    msgs: HashMap<String, (i64, String, String, Tokens)>, // message.id → (hora, proyecto, modelo, uso); Code repite la línea por bloque
    activity: Vec<(String, String, Vec<i64>)>,             // (proyecto, título, eventos) por archivo de sesión
    roots: Roots,
}

impl Scan {
    fn new(from: i64, to: i64) -> Self {
        let mut sc = Scan { from, to, ..Default::default() };
        let home = PathBuf::from(crate::home());
        let mut code = vec![];
        files(&home.join(".claude/projects"), 3, "jsonl", from - CAP_MS, &mut code);
        code.iter().for_each(|f| sc.code(f));
        let mut cowork = vec![];
        let lams = home.join("Library/Application Support/Claude/local-agent-mode-sessions");
        files(&lams, 2, "json", 0, &mut cowork); // el rango lo filtra `lastActivityAt`, no la fecha del archivo
        cowork
            .iter()
            .filter(|f| f.file_name().is_some_and(|n| n.to_string_lossy().starts_with("local_")))
            .for_each(|f| sc.cowork(f));
        let alias = moved(&sc.roots.0.values().map(|r| (r.1.clone(), r.2)).collect::<Vec<_>>());
        let to = |p: &mut String| {
            if let Some(g) = alias.get(p) {
                *p = g.clone();
            }
        };
        sc.prompts.iter_mut().for_each(|p| to(&mut p.project));
        sc.msgs.values_mut().for_each(|m| to(&mut m.1));
        sc.activity.iter_mut().for_each(|a| to(&mut a.0));
        sc.roots.0.retain(|_, r| !alias.contains_key(&r.1)); // ni ficha ni metadatos para la carpeta vieja
        sc
    }

    fn assistant(&mut self, v: &Value, ts: i64, project: String) {
        let m = &v["message"];
        let (Some(id), Some(model)) = (m["id"].as_str(), m["model"].as_str()) else { return };
        if model.starts_with('<') {
            return; // "<synthetic>": errores y avisos locales, sin tokens reales
        }
        let u = &m["usage"];
        let n = |k: &str| u[k].as_i64().unwrap_or(0);
        let t = Tokens {
            input: n("input_tokens"),
            output: n("output_tokens"),
            cache_read: n("cache_read_input_tokens"),
            cache_write: n("cache_creation_input_tokens"),
        };
        self.msgs.insert(id.to_string(), (ts, project, model.to_string(), t));
    }

    /// Una línea de un transcript: mensaje tuyo, respuesta de Claude y, siempre, actividad de la sesión.
    fn line(&mut self, v: &Value, ts: i64, human: bool, project: &str, title: &str, events: &mut Vec<i64>) {
        if human && ts >= self.from - CAP_MS && ts < self.to {
            self.prompts.push(Prompt { ts, project: project.into(), title: title.into() });
        }
        if ts >= self.from && ts < self.to {
            events.push(ts);
            if v["type"] == "assistant" {
                self.assistant(v, ts, project.into());
            }
        }
    }

    /// Un transcript de Code (`~/.claude/projects/<carpeta>/<sesión>.jsonl` o el de un subagente).
    fn code(&mut self, path: &Path) {
        let Ok(text) = std::fs::read_to_string(path) else { return };
        let (first, mut title, mut events) = (self.prompts.len(), String::new(), vec![]);
        let mut opening = None; // tu primer mensaje: el nombre de la sesión si no tiene título
        // Cada línea cuenta para el repo git de su carpeta; fuera de git, para la carpeta donde empezó la sesión (la que
        // da nombre a ~/.claude/projects/<carpeta>): Claude hace `cd 03/datos` y cada subcarpeta sería un proyecto.
        let (mut origin, mut project): (Option<String>, String) = (None, String::new());
        for v in text.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
            if v["type"] == "custom-title" {
                title = v["customTitle"].as_str().unwrap_or_default().to_string();
            }
            if opening.is_none() && human_code(&v) {
                opening = first_line(&v);
            }
            let (Some(ts), Some(cwd)) = (ms(&v), v["cwd"].as_str()) else { continue };
            let dir = origin.get_or_insert_with(|| cwd.to_string());
            if ts < self.from - CAP_MS || ts >= self.to {
                continue;
            }
            let dir = dir.clone();
            project = self.roots.project(cwd);
            if !self.roots.0[cwd].2 {
                project = self.roots.project(&dir);
            }
            self.line(&v, ts, human_code(&v), &project, "", &mut events);
        }
        if title.is_empty() {
            title = opening.unwrap_or_default();
        }
        self.prompts[first..].iter_mut().for_each(|p| p.title = title.clone()); // el título puede venir al final
        if events.len() > 1 {
            self.activity.push((project, title, events)); // ponytail: el proyecto de su última línea
        }
    }

    /// Una sesión de Cowork: `local_<id>.json` (carpeta elegida y título) y `local_<id>/audit.jsonl`.
    fn cowork(&mut self, meta: &Path) {
        let Some(m) = std::fs::read_to_string(meta).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else {
            return;
        };
        if m["lastActivityAt"].as_i64().unwrap_or(0) < self.from - CAP_MS || m["createdAt"].as_i64().unwrap_or(0) >= self.to {
            return;
        }
        let project = match m["userSelectedFolders"][0].as_str() {
            Some(dir) => self.roots.project(dir),
            None => "Cowork".to_string(),
        };
        let title = m["title"].as_str().unwrap_or_default().to_string();
        let Ok(text) = std::fs::read_to_string(meta.with_extension("").join("audit.jsonl")) else { return };
        let mut events = vec![];
        for v in text.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
            let Some(ts) = ms(&v) else { continue };
            self.line(&v, ts, human_cowork(&v), &project, &title, &mut events);
        }
        if events.len() > 1 {
            self.activity.push((project, title, events));
        }
    }
}

/// Archivos con extensión `ext` bajo `dir` (hasta `depth` niveles) modificados desde `since` (ms epoch).
fn files(dir: &Path, depth: u8, ext: &str, since: i64, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth > 0 {
                files(&p, depth - 1, ext, since, out);
            }
        } else if p.extension().is_some_and(|x| x == ext) {
            let modified = e.metadata().and_then(|m| m.modified()).unwrap_or(UNIX_EPOCH);
            if modified >= UNIX_EPOCH + Duration::from_millis(since.max(0) as u64) {
                out.push(p);
            }
        }
    }
}

/// `git log --numstat --format=@%ct` → un (ms, líneas agregadas, borradas) por commit. Binarios ("-") no suman.
pub fn parse_numstat(log: &str) -> Vec<(i64, i64, i64)> {
    let mut out: Vec<(i64, i64, i64)> = vec![];
    for l in log.lines() {
        if let Some(ts) = l.strip_prefix('@') {
            out.push((ts.trim().parse::<i64>().unwrap_or(0) * 1000, 0, 0));
        } else if let Some(c) = out.last_mut() {
            let mut f = l.split('\t');
            let n = |s: Option<&str>| s.and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
            (c.1, c.2) = (c.1 + n(f.next()), c.2 + n(f.next()));
        }
    }
    out
}

/// Tus commits en [from, to) en todas las ramas, y los que llegaron a main/master (first-parent: un commit directo o
/// el merge de un PR cuenta como un feature), con su hora en ms.
fn git_commits(root: &Path, from: i64, to: i64) -> (Vec<(i64, i64, i64)>, Vec<i64>) {
    let (since, until) = (format!("--since={}", iso(from)), format!("--until={}", iso(to)));
    let email = git(root, &["config", "user.email"]).unwrap_or_default();
    let author = format!("--author={}", email.trim());
    let mine = |args: &[&str]| {
        let mut args = args.to_vec();
        if !email.trim().is_empty() {
            args.push(&author);
        }
        git(root, &args).unwrap_or_default()
    };
    let commits = parse_numstat(&mine(&["log", "--all", "--no-merges", &since, &until, "--numstat", "--format=@%ct"]));
    let main = ["main", "master"].into_iter().find(|b| git(root, &["rev-parse", "--verify", "--quiet", b]).is_some());
    let features = main.map_or(vec![], |b| {
        let log = mine(&["log", b, "--first-parent", &since, &until, "--format=%ct"]);
        log.lines().filter_map(|l| l.trim().parse::<i64>().ok()).map(|s| s * 1000).collect()
    });
    (commits, features)
}

/// Todo lo de un foco [start, end). Lee archivos y corre git: llamarlo fuera del hilo principal.
pub fn collect(start: i64, end: i64) -> Work {
    let sc = Scan::new(start, end);
    let mut w = Work::default();
    let mut titles: HashMap<String, Vec<(i64, String)>> = HashMap::new();
    for ((project, title), ms) in attribute(&sc.prompts, start, end) {
        w.projects.entry(project.clone()).or_default().secs += ms / 1000;
        titles.entry(project).or_default().push((ms, title));
    }
    for (project, mut t) in titles {
        t.sort_by(|a, b| b.0.cmp(&a.0));
        let t: Vec<String> = t.into_iter().map(|t| t.1).filter(|t| !t.is_empty()).take(3).collect();
        w.projects.get_mut(&project).unwrap().detail = t.join(" · ");
    }
    for (_, project, model, t) in sc.msgs.into_values() {
        w.projects.entry(project.clone()).or_default();
        w.tokens.entry((project, model)).or_default().add(&t);
    }
    for (root, name) in sc.roots.repos() {
        if let Some(p) = w.projects.get_mut(&name) {
            let (commits, features) = git_commits(&root, start, end);
            p.commits = commits.len() as i64;
            p.added = commits.iter().map(|c| c.1).sum();
            p.removed = commits.iter().map(|c| c.2).sum();
            p.features = features.len() as i64;
        }
    }
    w
}

/// Registro por hora de [from, to), con o sin foco. Lo desatendido es lo que Claude hizo (trabajo, tokens, commits)
/// en un proyecto mientras tu atención no estaba en ese proyecto: de noche, sin foco o mientras mirabas otro.
pub fn hours(from: i64, to: i64) -> Hours {
    let sc = Scan::new(from, to);
    let mut h = Hours::default();
    let clamp = |v: Vec<Iv>| v.into_iter().map(|(a, b)| (a.max(from), b.min(to))).filter(|(a, b)| b > a).collect::<Vec<_>>();

    let mut you: HashMap<String, Vec<Iv>> = HashMap::new();
    for (iv, p) in attention(&sc.prompts) {
        you.entry(p.project.clone()).or_default().push(iv);
        let key = |hr| (hr, p.project.clone(), p.title.clone());
        per_hour(&clamp(vec![iv]), |hr, ms| h.titles.entry(key(hr)).or_default().0 += ms);
    }
    let you: HashMap<String, Vec<Iv>> = you.into_iter().map(|(k, v)| (k, union(clamp(v)))).collect();
    let mut claude: HashMap<String, Vec<Iv>> = HashMap::new();
    let mut by_title: HashMap<(String, String), Vec<Iv>> = HashMap::new();
    for (project, title, mut ev) in sc.activity {
        let r = runs(&mut ev);
        claude.entry(project.clone()).or_default().extend(r.iter().copied());
        by_title.entry((project, title)).or_default().extend(r);
    }
    for ((project, title), v) in by_title {
        per_hour(&union(v), |hr, ms| h.titles.entry((hr, project.clone(), title.clone())).or_default().1 += ms);
    }
    let none = vec![];
    for (project, v) in &you {
        per_hour(v, |hr, ms| h.work.entry((hr, project.clone())).or_default().you += ms);
    }
    for (project, v) in claude {
        let v = union(v);
        let mine = you.get(&project).unwrap_or(&none);
        per_hour(&v, |hr, ms| h.work.entry((hr, project.clone())).or_default().claude += ms);
        per_hour(&minus(&v, mine), |hr, ms| h.work.entry((hr, project.clone())).or_default().unattended += ms);
    }
    for (ts, project, model, t) in sc.msgs.into_values() {
        let away = !covers(you.get(&project).unwrap_or(&none), ts);
        let hr = ts.div_euclid(HOUR_MS) * HOUR_MS;
        let e = h.tokens.entry((hr, project, model)).or_default();
        e.0.add(&t);
        e.1 += if away { t.total() } else { 0 };
    }
    for (root, name) in sc.roots.repos() {
        let (commits, features) = git_commits(&root, from, to);
        let mine = you.get(&name).unwrap_or(&none);
        let hour = |ts: i64| (ts.div_euclid(HOUR_MS) * HOUR_MS, name.clone());
        for (ts, added, removed) in commits {
            let w = h.work.entry(hour(ts)).or_default();
            (w.commits, w.added, w.removed) = (w.commits + 1, w.added + added, w.removed + removed);
            w.unattended_commits += !covers(mine, ts) as i64;
        }
        features.into_iter().for_each(|ts| h.work.entry(hour(ts)).or_default().features += 1);
    }
    h.projects = sc.roots.meta();
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = 60_000;

    fn p(ts: i64, project: &str) -> Prompt {
        Prompt { ts, project: project.into(), title: String::new() }
    }

    #[test]
    fn reparte_por_el_ultimo_mensaje_con_tope() {
        // foco de 0 a 60 min: un mensaje a "pet" 2 min antes, "web" a los 5, "pet" a los 8 y nada hasta el final
        let prompts = [p(-2 * MIN, "pet"), p(8 * MIN, "pet"), p(5 * MIN, "web")];
        let r = attribute(&prompts, 0, 60 * MIN);
        let get = |k: &str| r.get(&(k.to_string(), String::new())).copied().unwrap_or(0);
        assert_eq!(get("web"), 3 * MIN);
        // 0–5 (el mensaje previo al foco sigue contando) + 8–18 (tope de 10 min); 18–60 queda sin atribuir
        assert_eq!(get("pet"), 5 * MIN + 10 * MIN);
    }

    #[test]
    fn tramos_union_resta_y_horas() {
        assert_eq!(union(vec![(5, 8), (0, 3), (2, 6), (10, 11)]), vec![(0, 8), (10, 11)]);
        assert_eq!(minus(&[(0, 10), (20, 30)], &[(2, 4), (8, 22)]), vec![(0, 2), (4, 8), (22, 30)]);
        assert!(covers(&[(0, 10), (20, 30)], 25) && !covers(&[(0, 10), (20, 30)], 15) && !covers(&[(0, 10)], 10));
        // Claude trabaja con eventos cada 1 min y se detiene 5 min: dos tramos
        assert_eq!(runs(&mut [3 * MIN, 0, MIN, 8 * MIN, 9 * MIN]), vec![(0, MIN), (MIN, 3 * MIN), (8 * MIN, 9 * MIN)]);
        let mut by = HashMap::new();
        per_hour(&[(HOUR_MS - 10 * MIN, HOUR_MS + 5 * MIN)], |h, ms| *by.entry(h).or_insert(0) += ms);
        assert_eq!(by, HashMap::from([(0, 10 * MIN), (HOUR_MS, 5 * MIN)]));
    }

    #[test]
    fn solo_cuentan_tus_mensajes() {
        let v = |s: &str| serde_json::from_str::<Value>(s).unwrap();
        assert!(human_code(&v(r#"{"type":"user","origin":{"kind":"human"},"message":{"content":"hola"}}"#)));
        assert!(human_code(&v(r#"{"type":"user","entrypoint":"cli","message":{"content":"hola"}}"#)));
        // avisos de la app de escritorio, resultados de herramientas y subagentes no
        assert!(!human_code(&v(r#"{"type":"user","entrypoint":"claude-desktop","message":{"content":"<system-reminder>"}}"#)));
        assert!(!human_code(&v(
            r#"{"type":"user","origin":{"kind":"human"},"message":{"content":[{"type":"tool_result"}]}}"#
        )));
        assert!(!human_code(&v(r#"{"type":"user","isSidechain":true,"origin":{"kind":"human"},"message":{"content":"x"}}"#)));
        assert!(human_cowork(&v(r#"{"type":"user","parent_tool_use_id":null,"message":{"content":"hola"}}"#)));
        assert!(!human_cowork(&v(r#"{"type":"user","isSynthetic":true,"message":{"content":[{"type":"text"}]}}"#)));
    }

    #[test]
    fn la_carpeta_vieja_se_une_a_su_repo() {
        let p = |k: &str, git: bool| (k.to_string(), git);
        let m = moved(&[
            p("Documents/U/2026-2/ML/Laboratorios", false),
            p("Library/OneDrive-X/2026-2/ML/Laboratorios", true),
            p("Documents/U/Estructuras/Laboratorios", false), // sin repo: queda aparte
            p("Documents/a/b/c", false),
            p("x/a/b/c", true),
            p("y/a/b/c", true), // dos repos candidatos: no adivina
            p("~", false),
        ]);
        assert_eq!(m, HashMap::from([("Documents/U/2026-2/ML/Laboratorios".into(), "Library/OneDrive-X/2026-2/ML/Laboratorios".into())]));
    }

    #[test]
    fn remoto_y_primera_linea() {
        assert_eq!(remote("git@github.com:diegoalrv/desktop-pet.git"), "github.com/diegoalrv/desktop-pet");
        assert_eq!(remote("https://x-token:abc@github.com/a/b.git\n"), "github.com/a/b");
        assert_eq!(remote(""), "");
        let v = |s: &str| serde_json::from_str::<Value>(s).unwrap();
        assert_eq!(first_line(&v(r#"{"message":{"content":"  Revisa el lab 9\ny luego"}}"#)).as_deref(), Some("Revisa el lab 9"));
        assert_eq!(first_line(&v(r#"{"message":{"content":[{"type":"text","text":"hola"}]}}"#)).as_deref(), Some("hola"));
        assert_eq!(first_line(&v(r#"{"message":{"content":"<command-name>/clear</command-name>"}}"#)), None);
    }

    #[test]
    fn numstat_cuenta_commits_y_lineas() {
        let log = "@100\n\n10\t2\tsrc/a.rs\n-\t-\timg.png\n@200\n\n1\t0\tREADME.md\n";
        assert_eq!(parse_numstat(log), vec![(100_000, 10, 2), (200_000, 1, 0)]);
    }
}

#[cfg(test)]
mod real {
    /// `cargo test worklog::real -- --ignored --nocapture`: con tus archivos de verdad.
    #[test]
    #[ignore]
    fn ultimas_horas() {
        let end = chrono::Utc::now().timestamp_millis();
        let t = std::time::Instant::now();
        let w = super::collect(end - 3 * 3600 * 1000, end);
        println!("{:?}\n{:#?}\n{:#?}", t.elapsed(), w.projects, w.tokens);
    }

    #[test]
    #[ignore]
    fn ultimas_24_horas_por_proyecto() {
        let end = chrono::Utc::now().timestamp_millis();
        let t = std::time::Instant::now();
        let h = super::hours(end - 24 * 3600 * 1000, end);
        let mut by: std::collections::HashMap<String, super::Hour> = Default::default();
        for ((_, p), w) in h.work {
            let s = by.entry(p).or_default();
            (s.you, s.claude, s.unattended, s.commits, s.unattended_commits) = (
                s.you + w.you,
                s.claude + w.claude,
                s.unattended + w.unattended,
                s.commits + w.commits,
                s.unattended_commits + w.unattended_commits,
            );
        }
        println!("{:?}", t.elapsed());
        for (p, s) in by {
            let m = |ms: i64| ms / 60_000;
            println!(
                "{p:30} tú {:4}m  claude {:4}m  desatendido {:4}m  commits {} ({} desat.)",
                m(s.you),
                m(s.claude),
                m(s.unattended),
                s.commits,
                s.unattended_commits
            );
        }
    }

    #[test]
    #[ignore]
    fn historial_completo() {
        let t = std::time::Instant::now();
        let h = super::hours(0, chrono::Utc::now().timestamp_millis());
        let first = h.work.keys().map(|k| k.0).min().unwrap_or(0);
        let (claude, away): (i64, i64) = h.work.values().fold((0, 0), |a, w| (a.0 + w.claude, a.1 + w.unattended));
        println!("{:?}: {} horas-proyecto desde {}, claude {} h, desatendido {} h", t.elapsed(), h.work.len(), super::iso(first), claude / 3_600_000, away / 3_600_000);
    }
}
