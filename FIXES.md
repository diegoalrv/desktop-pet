# FIXES

Arreglos pendientes, en orden de prioridad. Un commit por fix (mensajes en el estilo del log: español, una línea,
sin punto final). Antes de cada commit: `pnpm test`, `pnpm lint`, `cd src-tauri && cargo test`. Los fixes 1 y 2
solo se pueden probar de verdad en macOS con una reunión real.

## 0. Commitear lo pendiente — HECHO (4a805c7)
Quedan sin trackear `tsconfig*.tsbuildinfo` y `.claude/` (ver fix 10) y este `FIXES.md`.

## 1. Reuniones: el candado del audio queda tomado mientras whisper transcribe (CRÍTICO) — HECHO (9607996)
`src-tauri/src/meeting.rs`, closure `push` dentro de `mac::run` (~línea 526):
```rust
while let Some(chunk) = take_chunk(&mut bufs.lock().unwrap()[src], flush) {
```
El `MutexGuard` temporal del encabezado del `while let` vive durante todo el cuerpo del bucle, incluida
`transcribe(&chunk)` (~2 s por fragmento). Mientras tanto `Capture::did_output_sample_buffer` (callback de
ScreenCaptureKit, micrófono y sistema comparten el mismo `Mutex`) se bloquea en `self.0.lock()` y el audio que llega
se apila o se pierde → huecos / frases cortadas en la transcripción.

Cambio: soltar el candado antes de transcribir.
```rust
for src in 0..2 {
    loop {
        // El candado se suelta aquí mismo: transcribir tarda ~2 s y el callback de ScreenCaptureKit
        // no puede esperar tanto para guardar el audio que va llegando.
        let chunk = { let mut b = bufs.lock().unwrap(); take_chunk(&mut b[src], flush) };
        let Some(chunk) = chunk else { break };
        if rms(&chunk) < SILENCE / 2.0 { continue; }
        …
    }
}
```
Verificar: `cargo clippy -W clippy::significant_drop_in_scrutinee` (en macOS) avisa antes y no después. Prueba real:
un video de alguien hablando 2 min seguidos, grabar antes/después y comparar cuánto texto sale.
Anotar en NOTES.md la regla: nunca tener el candado de `bufs` tomado fuera de `take_chunk`/`extend_from_slice`.
Commit: `Soltar el candado del audio antes de transcribir: el callback de ScreenCaptureKit no espera`

## 2. Reuniones: la música (y la campanilla) entran como "Otros" — DESCARTADO (en reunión no hay música; la campanilla dura 1 s y `clean` la filtra)
`with_excludes_current_process_audio(true)` excluye el audio del proceso de la app, pero WebKit reproduce desde un
proceso aparte (GPU/WebContent), así que YouTube Music y la campanilla del panel se capturan como audio del sistema.
Primero confirmar: canción con letra sonando, "Escuchar reunión" 30 s, ver si la letra aparece en "Otros".
Si se confirma, en orden:
1. En `start_capture`, excluir la propia app en el `SCContentFilter` (la variante del builder que excluye
   aplicaciones; nombre exacto en la doc de la crate `screencapturekit` 11): buscar en `content.applications()` la
   que tenga `process_id() == std::process::id()` (o `bundle_identifier() == "xyz.spadelab.pet"`). SCK agrupa los
   procesos hijos bajo la app, así que debería tapar música y campanilla sin pausar nada.
2. Si no funciona: pausar la música al empezar la reunión y reanudarla al terminar. Agregar comandos `pause`/`play`
   explícitos a `music_bridge.js` (`toggle` es ambiguo si el usuario tocó algo a mano); en `meeting_start` leer
   `music::music_state()["playing"]`, pausar y recordar; al terminar `run`, reanudar solo si la pausamos nosotros y
   sigue en pausa.
Commit: `Excluir la propia app del audio de la reunión: la música ya no se transcribe como Otros`

## 3. Timer: un foco que vence con la app cerrada se guarda con la hora equivocada — HECHO (8b53b0b)
`src-tauri/src/timer.rs`, `restore` (~línea 226):
```rust
let now = now_ms();
if let Some(done) = t.due(now) {
    crate::db::record_session(app, &done, now);   // end = ahora, no cuando venció
    t.reset(now);
}
```
La sesión queda con `end` = hora de reabrir la app (`start` = end − elapsed). Un foco que terminó anoche aparece
hoy y descuadra racha, 14 días y foco por hora.
Cambio: sacar la lógica a un método puro y testeable:
```rust
/// Si venció con la app cerrada: lo completa a su hora real (no ahora) y queda en reposo.
pub fn catch_up(&mut self, now: u64) -> Option<(Done, u64)> {
    let end = self.end.filter(|&e| self.status == Status::Running && e <= now)?;
    let done = self.complete(end, false)?;
    self.reset(now);
    Some((done, end))
}
```
y en `restore`: `if let Some((done, end)) = t.catch_up(now) { crate::db::record_session(app, &done, end); }`.
Test en `timer.rs`: foco de 1500 s iniciado en t0, `catch_up(t0 + 10 h)` → `end == t0 + 1_500_000`, `elapsed ==
1500`, status Idle; `catch_up(t0 + 100)` → `None` y sigue Running; en Paused → `None`.
Commit: `Registrar a su hora real el foco que venció con la app cerrada`

## 4. Tareas: cambiar la fecha de una tarea ya recordada no vuelve a avisar — HECHO (e2246e1)
`src/lib/db.ts` `updateTask`: al editar `due_at` (desde `TasksWindow.tsx:290`, `up("due_at", …)`), `notified` sigue
en 1 y `needsReminder` nunca vuelve a ser cierto.
Cambio: en `updateTask`, si `field === "due_at"` agregar `, notified = 0` al `SET`. Dejar la construcción del SQL
en un helper puro (`updateSql(field)`) con un test en `src/lib/tasks.test.ts` o nuevo `db.test.ts` sin sqlite.
Commit: `Volver a recordar una tarea cuando se le cambia la fecha`

## 5. Web local: token para los POST — HECHO (342b00e)
`src-tauri/src/web.rs` protege contra otras webs (Host, Origin, JSON) pero no contra otros procesos/usuarios del Mac:
cualquiera que llegue a `127.0.0.1:4747` ejecuta SQL (`/api/execute`), lee transcripciones y chat, y puede llamar
`meeting_start` (graba con los permisos de micrófono/pantalla de la app).
Cambio:
- Token aleatorio por arranque (16 bytes de `/dev/urandom` en hex, `static TOKEN: OnceLock<String>`), solo en
  memoria.
- `open_web` abre `http://127.0.0.1:{PORT}/?t=<token>` (en debug, `http://localhost:1420/?t=<token>`; el tray
  "Abrir web de tareas" ya usa `open_web`).
- Frontend (`src/web/Dashboard.tsx` o `src/lib/db.ts`): al cargar, si hay `?t=` lo guarda en `localStorage` y lo
  quita de la URL con `history.replaceState`; `db.ts` e `ipc.ts` mandan `X-Pet-Token` en cada POST.
- `trusted()`: los POST exigen el header igual al token (los GET de estáticos no). Sin token → 401.
- Si un POST devuelve 401, el panel muestra: "La app se reinició: ábrela de nuevo desde el menú de la barra
  (Abrir web de tareas)".
- NOTES.md: por qué el token es por arranque (el DB ya es legible por cualquier proceso del mismo usuario; lo que se
  protege es que otro proceso use el micrófono a través de la app).
Commit: `Token por arranque para la web local: solo la pestaña abierta desde la app puede llamar a la app`

## 6. Chat: cancelar una orden y matar `claude` al salir — HECHO (e1c0900)
`src-tauri/src/claude.rs`: no hay forma de cancelar y el proceso sigue vivo si se cierra la app (`exec claude` en
zsh → el pid del hijo es `claude` mismo, `kill` funciona directo).
Cambio:
- Estado `ClaudeChild(Mutex<Option<Child>>)` (managed); `claude_ask` lo guarda; comando nuevo `claude_cancel` que
  hace `kill()`. El hilo lector ve EOF y emite `claude://exit` con outcome `oops` y error "cancelado".
- Al salir: pasar de `.run(ctx)` a `.build(ctx)?.run(|app, e| if let RunEvent::Exit = e { matar el hijo })`.
- `src/panel/ChatTab.tsx`: botón "Cancelar" junto a "Candola está pensando…".
Commit: `Cancelar la orden en curso del chat y matar claude al salir de la app`

## 7. Lint: `any` en `src/panel/ChatTab.tsx:59` — HECHO (3f76718)
Tipar el evento de stream-json:
```ts
type ClaudeEvent = {
  type: string; session_id?: string; is_error?: boolean; result?: string; permission_denials?: Denial[];
  message?: { content?: { type: string; text?: string; name?: string;
    input?: { command?: string; file_path?: string; pattern?: string } }[] };
};
```
y `listen<ClaudeEvent>(…)`. `pnpm lint` debe quedar en 0.
Commit: `Tipar los eventos de Claude Code en el chat`

## 8. Prettier — HECHO (5a48b0a)
`pnpm prettier --write src` (24 archivos). Solo formato, sin lógica; `pnpm test` y `pnpm lint` después.
Commit: `Prettier en src`

## 9. Metadatos de `src-tauri/Cargo.toml` — HECHO (3a8d3ce)
Siguen los de la plantilla: `name = "tauri-app"`, `description = "A Tauri App"`, `authors = ["you"]`. Cambiar
`description` y `authors` (SpadeLab). Renombrar el paquete es opcional: obliga a cambiar `[lib] name` y
`src-tauri/src/main.rs` (`tauri_app_lib::run()`) y recompila todo (`target/` pesa 16 GB; `cargo clean` lo libera).
Commit: `Metadatos de Cargo.toml`

## 10. Git: ignorar lo generado y limpiar `.claude/launch.json` — HECHO (f89b90b)
- `.gitignore`: `*.tsbuildinfo` (hay dos sin trackear).
- `.claude/launch.json`: la entrada `web-preview` apunta a una ruta temporal de `/private/tmp` que ya no existe;
  borrarla. Decidir si `.claude/` se commitea (config compartida) o se ignora (config de esta máquina); si se
  ignora, agregarlo a `.gitignore`.
Commit: `Ignorar tsbuildinfo y limpiar launch.json`

## 11. PROGRESS.md — HECHO
Al terminar, anotar en PROGRESS.md (sección Reuniones y Timer) los fixes 1–3 y 12 en una línea cada uno, como está el
resto del archivo.

## 12. Reuniones: `claude -p` como proveedor (5cba280) — robustecer — HECHO (ver nota)
`src-tauri/src/meeting.rs`, `ask_claude_code`:
- **Sin timeout.** `wait_with_output()` espera para siempre; si `claude` se cuelga (login vencido, diálogo de
  confianza, red caída) el hilo de la reunión queda en "Buscando tareas…" sin salida y la próxima reunión falla con
  "Hay una reunión en curso". Poner un límite (p. ej. 5 min): hilo lector + `try_wait` en bucle, o `kill()` al
  vencer, y devolver `Err` para que `ask_any` pase al siguiente modelo/proveedor.
- **Cómo se encuentra el binario.** La lista fija (`claude`, `/opt/homebrew/bin`, `/usr/local/bin`,
  `~/.claude/local`) no incluye `~/.local/bin/claude`, que es donde instala el instalador nativo (`claude install`).
  Hacer lo mismo que `claude.rs`: `/bin/zsh -lc 'exec claude "$@"'` para heredar el PATH del usuario, en vez de
  adivinar rutas. Sacar el lanzamiento a una función compartida entre `claude.rs` y `meeting.rs`.
- **Flags que ayudan** (CLI reference de Claude Code, verificados):
  - `--bare`: salta hooks, plugins, MCP servers, skills y CLAUDE.md → arranca más rápido y el CLAUDE.md global
    del usuario no contamina la respuesta.
  - `--json-schema '<schema de {"tareas":[{"titulo","detalle"}]}>'` con `--output-format json`: la salida llega
    validada en `structured_output`; se puede dejar `parse_tasks` solo como respaldo.
  - `--max-turns 1` como cinturón (sin herramientas no debería hacer más de uno).
- Test: `probar_llm` ya cubre el flujo con `LLM_PROVIDER=claude-code`; dejarlo documentado en su doc-comment.
Nota (hecho en `claude -p con timeout y lanzado con el PATH del usuario`): timeout de 5 min y lanzador compartido
(`claude::command`) hechos y probados con `probar_llm` (`LLM_PROVIDER=claude-code`). Flags descartados: `--bare`
desactiva OAuth/keychain y exige ANTHROPIC_API_KEY (rompe el "sin API key"); `--json-schema` necesitaría un schema
por llamada (`parse_tasks` y `parse_actions` esperan JSON distinto) y `json_of` ya lo parsea; `--max-turns` no
existe en la CLI instalada (2.1.236).
