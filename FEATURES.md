# FEATURES

Features propuestas, en lotes. Mismo formato y reglas que FIXES.md: un commit por feature (o por paso cuando una
feature tiene varios), `pnpm test` + `pnpm lint` + `cargo test` antes de cada commit, test para toda lógica pura
nueva, y una línea en PROGRESS.md al terminar cada una. FIXES.md ya está hecho (el fix 5, token de la web, era
prerequisito de F9).

Convenciones del proyecto que hay que respetar: prefs nuevas en `src/lib/prefs.ts` (zod, con default en `.catch`)
+ UI en `src/settings/SettingsWindow.tsx` + test en `prefs.test.ts`; comandos nuevos registrados en
`generate_handler!` de `lib.rs` y, si la web los necesita, en la lista cerrada de `web.rs::invoke`; eventos
`algo://cosa`; la mascota reacciona en `src/pet/stateMachine.ts` (con test); nada de personajes de terceros.
Migraciones: usar el siguiente número libre en `src-tauri/migrations/` (hoy existe hasta `005_meeting_actions.sql`),
en el orden en que se implementen; los números de abajo son orientativos.

Descartadas (22-oct-2026): F3 (música por modo), F14 (reuniones en Windows) y F15 (skin desde una foto). Los
números del resto se mantienen para no romper referencias.

---------------------------------------------------------------------------------------------------------------
## Lote 1 — baratas, alto uso diario
---------------------------------------------------------------------------------------------------------------

## F1. Timer en la barra de menú
Qué: al lado del ícono del tray, `🍅 12:34` en foco, `☕ 04:10` en pausa, `⏸ 12:34` en pausa manual, nada en reposo.
Cómo:
- `tray.rs`: hoy usa `TrayIconBuilder::new()`; cambiar a `TrayIconBuilder::with_id("tray")`. Nueva fn
  `tray::set_title(app, Option<String>)` que hace `app.tray_by_id("tray")?.set_title(title)` (macOS; en otros SO
  es no-op).
- `timer.rs`: OJO, deadlock. `TrayIcon::set_title` despacha al hilo principal y espera la respuesta
  (`run_item_main_thread!` en Tauri 2.12), y los comandos síncronos (`timer_pause`, `timer_resume`…) corren en el
  hilo principal y piden el candado del timer. `spawn`, `finish` y los comandos llaman `emit_tick`/`changed` con el
  candado tomado, así que llamar `set_title` ahí cuelga la app. Hacer: con el candado tomado solo calcular el texto
  (`Option<String>`); soltar el guard y recién entonces llamar `tray::set_title` (en el hilo del timer: devolver
  el texto desde el bloque con el lock y llamar fuera; en los comandos: `drop(t)` antes). Para no redibujar la
  barra 4 veces por segundo, recordar el último texto en un `Mutex<String>` aparte (no el del timer) y solo
  actualizar si cambió (cambia una vez por segundo).
- Pref `trayTimer: boolean` (default true) en Ajustes → Timer: "Mostrar el tiempo en la barra de menú".
- La función que formatea (`mode, status, remaining → String`) es pura: test en `timer.rs`.
Commit: `Tiempo restante del timer en la barra de menú`

## F2. Atajo global para iniciar/pausar el foco
Qué: segundo atajo (default `CommandOrControl+Shift+F`): en reposo inicia un foco con la duración de Ajustes y la
última tarea; corriendo → pausa; en pausa → reanuda. Mismo comportamiento que el botón principal del panel.
Cómo:
- `windows.rs`: generalizar `QuickShortcut` a N atajos por tipo (`Mutex<HashMap<&'static str, String>>`, no un
  struct de dos campos: F10 agrega un tercero) y `set_quick_shortcut(kind, accel)`. Rechazar un `accel` que ya
  use otro tipo ("Ese atajo ya está asignado a …"): si no, al reemplazar se desregistraría el atajo del otro.
- `lib.rs` handler del plugin: hoy ignora el segundo argumento; comparar `shortcut` con cada atajo registrado y
  despachar (`toggle_panel` o `timer::toggle_focus`).
- `timer.rs`: `pub fn toggle_focus(app)` con la lógica de arriba (reusa `start_focus`, `pause`, `resume`).
- Pref `focusShortcut` + captura de teclas en Ajustes, igual que `shortcut` (reusar el componente).
Commit: `Atajo global para iniciar, pausar y reanudar el foco`

## F4. Reuniones con nombre y contexto del calendario
Qué: la transcripción se guarda con el título y los asistentes del evento del calendario que está ocurriendo;
el LLM los recibe (acierta mejor "quién lo pidió"); la lista de reuniones muestra el título en vez de la fecha
pelada; la notificación de "Reunión en 2 min" trae el botón/acción "Escuchar".
Cómo:
- `lib/calendar.ts`: `Meeting` hoy es `{key, title, start, end}`; agregar `attendees` (ATTENDEE → CN o mail) y
  `description`.
- `meeting_start` recibe `ctx: Option<{title, attendees}>` (el panel/web lo manda si hay un evento en curso ±10
  min; `PetWindow` ya tiene `meetings.current`). Pasarlo también en `web.rs::invoke`, que hoy solo lee `manage`. Rust lo guarda como cabecera YAML en el `.md`
  (`---\ntitle: …\nattendees: …\n---`) y `parse_lines` la ignora; `meetings_list` la devuelve aparte.
- `prompt()`: si hay contexto, agregar "Reunión: <título>. Participantes: <lista>. 'Yo' es <nombre del usuario>".
  Nombre del usuario: pref `userName` (Ajustes → Reuniones).
- Notificación 2 min antes: tauri-plugin-notification v2 no tiene botones de acción multiplataforma; alternativa
  barata: la notificación abre el panel en la pestaña Reunión (`panel://quick-capture` ya hace algo parecido) y el
  botón "Escuchar reunión" queda a un clic.
Test: cabecera ida/vuelta (`fmt`/`parse`) y `attendees` en `calendar.test.ts`.
Commit: `Reuniones con título y asistentes del calendario`

## F5. Resumen y decisiones de la reunión
Qué: además de tareas, el LLM devuelve `resumen` (3–5 líneas) y `decisiones` (lista). Se guardan y se muestran en la
vista de la reunión (web y panel), encima de la transcripción.
Cómo:
- Misma llamada: ampliar `PROMPT`/`prompt()` y `parse_tasks` → `parse_result` que devuelve `{tareas, resumen,
  decisiones}` (tolerante: si faltan, vacío). Sin `--json-schema`: FIXES 12 lo descartó (`json_of` ya parsea la
  respuesta de todos los proveedores).
- Solo reuniones normales: en modo Gestión (`MANAGE_PROMPT` / `parse_actions`) es un dictado, no una reunión; no
  pide resumen ni decisiones y no escribe en `meeting_notes`.
- Tabla `meeting_notes (meeting INTEGER PRIMARY KEY, summary TEXT, decisions TEXT /* JSON */, model TEXT, at
  INTEGER)` (migración siguiente libre, 006 si va primero). `meeting_retry` la reemplaza.
- `web/Meetings.tsx`: bloque "Resumen" + "Decisiones" arriba; "Copiar/descargar .md" incluye ambos.
Test: `parse_result` con y sin campos; `probar_llm` imprime el resumen.
Commit: `Resumen y decisiones de cada reunión`

## F6. Informe de horas por proyecto
Qué: vista web "Informe": rango (esta semana / semana pasada / mes / fechas), tabla proyecto × día con horas de
foco, total por proyecto, sin proyecto aparte; exportar CSV y Markdown. Para facturar.
Cómo:
- `lib/db.ts`: `focusByProjectDay(from, to)`:
  `SELECT COALESCE(t.project,'') AS project, s.start, s.end FROM sessions s LEFT JOIN tasks t ON t.id = s.task_id
   WHERE s.mode='focus' AND s.start >= $1 AND s.start < $2`.
  Ojo: con `s.start >= $1` se pierde la sesión que empezó antes del rango; usar `s.end > $1 AND s.start < $2` y
  recortar en `pivot`.
- `lib/stats.ts`: `pivot(rows, from, to) → { projects: [{name, days: number[], total}], days: number[] }` puro con
  test; reparte entre días la sesión que cruza medianoche y recorta la que se sale del rango (test de ambos);
  opción de redondeo a 15 min (`roundTo`) para facturación, con test.
- `web/Report.tsx` + entrada en `VIEWS` (`report`, "Informe", ícono `chart`); export con `download()` de `kit.tsx`.
Commit: `Informe de horas de foco por proyecto, exportable`

## F7. Cierre del día
Qué: a una hora configurable (pref `dayEndHour`, default 18, 0 = apagado) y si hubo actividad, Candolita avisa
(notificación + anim `celebrate` si se cumplió la meta, `tea` si no) y el panel muestra el cierre: focos y tiempo
de hoy vs. meta (pref `dailyGoalMin`), tareas hechas, vencidas sin hacer, sugerencias sin revisar. Botón "Copiar
como standup" (texto: ayer/hoy/bloqueos a partir de tareas y sesiones).
Cómo: `PetWindow` ya tiene un `setInterval` de 20 s para recordatorios: ahí mismo, una vez por día (clave
`dayEnd:<fecha>` en el store), evaluar y emitir. Resumen calculado con lo que ya hay en `stats.ts`; la plantilla
del standup en `lib/standup.ts` con test.
Commit: `Cierre del día con resumen y texto de standup`

## F8. Tareas recurrentes
Qué: `repeat: "none" | "daily" | "weekdays" | "weekly" | "monthly"` por tarea. Al completarla, se crea la
siguiente con `due_at` avanzado (misma hora) y `notified = 0`; la original queda hecha (historial intacto).
Cómo: migración siguiente libre `ALTER TABLE tasks ADD COLUMN repeat TEXT NOT NULL DEFAULT 'none'`. La lógica va
en Rust, no en `db.ts`: el `complete_task` del MCP (F9) no pasa por `db.setDone` y se saltaría la recurrencia.
- `db.rs`: comando `task_set_done(id, done)` que marca la tarea y, si `done && repeat != 'none'`, inserta la
  siguiente con `next_due(due, repeat, now)` (pura, `cargo test`: fin de mes, fines de semana, vencida hace días).
  Registrado en `generate_handler!` y en la lista de `web.rs::invoke`.
- `db.setDone` (panel, web, `acceptSuggestion` → "completar") pasa a llamar ese comando.
UI: selector en el gestor de tareas y en el panel (ícono ↻ en la lista).
Commit: `Tareas recurrentes`

---------------------------------------------------------------------------------------------------------------
## Lote 2 — medianas, cambian lo que la app es
---------------------------------------------------------------------------------------------------------------

## F9. Candola con herramientas (MCP) — REQUIERE FIXES 5
Qué: el chat deja de ser solo "leer el Mac": la Candola puede leer y manejar tareas, timer, reuniones y
sugerencias. "¿Qué tengo para hoy?", "agrega 'mandar propuesta' para el viernes", "empieza un foco con la tarea
de Colbún", "¿qué quedó de la reunión de ayer?".
Cómo:
- `mcp/pet-mcp.mjs`: servidor MCP stdio (`@modelcontextprotocol/sdk`, dependencia del paquete; `node` del usuario
  vía el zsh de login). Habla con la app por `http://127.0.0.1:<PORT>` con el token (env `PET_TOKEN`, `PET_PORT`).
  Herramientas (schemas con zod): `list_tasks({filter: today|pending|all})`, `add_task({title, due_at?, project?,
  priority?})`, `complete_task({id})`, `timer_get()`, `timer_start({mode?, task_id?})`, `timer_pause()`,
  `meetings_list({limit?})`, `meeting_get({id})`, `meeting_search({q})`, `suggestions_list()`,
  `suggestion_set({id, status})`. Usan `/api/select`, `/api/execute` e `/api/invoke` igual que `db.ts`/`ipc.ts`.
  `complete_task` va por `/api/invoke` → `task_set_done` (F8), no por SQL directo. Las reuniones son `.md` en
  `$APPDATA/meetings`, no SQL: `meeting_get` y `meeting_search` necesitan comandos nuevos en `meeting.rs` (leer
  un archivo por id; buscar texto en todos) registrados en `generate_handler!` y en `web.rs::invoke`.
  El token es por arranque: `claude_ask` lo inyecta en el env en cada llamada, así que un reinicio de la app no
  rompe el MCP; no cachearlo en otro lado.
- Empaquetar: carpeta `mcp/` como recurso del bundle (`bundle.resources` en `tauri.conf.json`); ruta en runtime
  con `app.path().resource_dir()`. En dev, la carpeta del repo.
- `claude.rs::claude_ask`: `--mcp-config '{"mcpServers":{"pet":{"command":"node","args":["<ruta>"],"env":{…}}}}'`
  y `mcp__pet__*` dentro de `READ_ONLY` (las herramientas de escritura —add/complete/timer— también van
  permitidas: son acciones de la propia app, reversibles).
- `candola.md`: sección "Tu humano y su día" describiendo las herramientas y cuándo usarlas; que prefiera las
  herramientas a adivinar.
- Panel: las sugerencias iniciales del chat (`SUGGESTIONS` en `ChatTab.tsx`) cambian a "¿Qué tengo para hoy?",
  "¿Qué quedó de la última reunión?", "¿Cómo va mi semana?".
Verificar: `node mcp/pet-mcp.mjs` con el inspector de MCP contra la app corriendo; luego desde el chat.
Commit (varios): `Servidor MCP de la app`, `La Candola usa las herramientas de la app en el chat`.

## F10. Hablarle a la Candola
Qué: atajo (pref) → graba el micrófono hasta soltar la tecla o 10 s → whisper → la orden entra al chat como
si la hubieras escrito; la respuesta se lee con `say` de macOS (pref `voice`, default apagada).
Cómo:
- `meeting.rs`: sacar a `whisper.rs` la carga del modelo (`model_path`, `WhisperContext`) y `transcribe`;
  mantener el contexto cargado en un `OnceLock`/`Mutex<Option<…>>` para no recargar 550 MB por frase (la reunión
  lo reutiliza).
- Captura solo micrófono: ya existe, es el modo Gestión (`start_capture(…, manage = true)` →
  `with_captures_audio(false)`). Reusarlo tal cual (sigue necesitando ScreenCaptureKit y su permiso; aceptable
  porque ya se pide para reuniones).
- Solapa con el modo Gestión (dictar → acciones sobre tareas). Con F9 hecha, el dictado a la Candola cubre eso
  mismo; al terminar F10, evaluar si el modo Gestión sobra y quitarlo.
- El atajo es mantener-presionado: en el handler del plugin usar `ShortcutState::Pressed` → `voice_start` y
  `Released` → `voice_stop` (el de F2 solo mira `Pressed`). Va en el mismo `HashMap` de atajos de F2.
- Comandos `voice_start` / `voice_stop` → `voice://text`; `ChatTab` lo mete en `run()`. TTS: `say -v <voz>` con el
  texto plano de la respuesta (ya es texto plano por diseño del prompt).
- Mascota: anim `listen` mientras graba (existe en Candolita).
Commit: `Hablarle a la Candola: atajo, whisper y respuesta en voz`

## F11. Distracciones durante el foco
Qué: durante un foco, la app sabe qué aplicación está al frente. Guarda tiempo por app en la sesión y, si abres
una app de la lista de distracciones (pref `distractions: string[]` de bundle ids, con selector de apps
corriendo), Candolita se pone `oops`, suma una distracción y, si dura > 1 min, notifica. En la web: tiempo por app
por sesión y distracciones por día.
Cómo:
- Rust (macOS): `NSWorkspace::sharedWorkspace().frontmostApplication()` (objc2-app-kit, features `NSWorkspace`,
  `NSRunningApplication`), polling 1 s solo mientras `status == Running && mode == Focus`, en el hilo del timer o
  uno propio. Acumula `HashMap<bundle_id, secs>` en `TimerState`; `record_session` lo vuelca en tabla
  `session_apps (session_id, bundle, name, secs)` (migración).
- Evento `focus://distraction {bundle, name}` → `stateMachine` evento `distracted` → `oops` 3 s y vuelve a `focus`
  (test).
- Windows: `GetForegroundWindow` + `GetWindowThreadProcessId`, o dejar pendiente.
Commit: `Tiempo por app y distracciones durante el foco`

## F12. VAD de verdad en las reuniones
Qué: reemplazar el umbral RMS fijo (`SILENCE`) por detección de voz (Silero VAD, que whisper.cpp trae desde 2025):
cortes en pausas reales del habla, no se transcriben fragmentos sin voz, menos alucinaciones.
Cómo: `whisper-rs` 0.16 ya expone el VAD (verificado: `WhisperVadContext::new(model, WhisperVadContextParams)`,
`segments_from_samples(WhisperVadParams, &[f32])`; modelo `ggml-silero-v5.1.2.bin`, ~1 MB, descargar junto al de
voz). `take_chunk` pasa a cortar en el último segmento sin voz según el VAD; mantener la firma para que los tests
sigan valiendo (inyectar la función de "silencio").
Commit: `Cortes por voz (Silero VAD) en la transcripción`

## F13. Preguntarle a las reuniones
Qué: en la vista Reuniones, una pregunta libre ("¿qué dijimos del plazo del proyecto?") responde citando las
reuniones y líneas usadas.
Cómo: embeddings locales con Ollama (`nomic-embed-text`, `/api/embeddings`) por bloque de ~10 líneas; tabla
`meeting_chunks (meeting, idx, text, vec BLOB)`; se indexa al guardar cada reunión y al arrancar lo que falte.
Pregunta → embedding → coseno en Rust (pocos miles de vectores, sin índice) → top 8 → LLM (`ask_any` con un prompt
de respuesta con citas) → respuesta + enlaces `#meetings/<id>`. Si Ollama no está, el campo lo dice.
Commit: `Preguntas sobre las reuniones con búsqueda semántica local`

## F17. Webcam durante el foco: teléfono y ausencia — DESPUÉS DE F11
Qué: opcional (pref `focusCam`, default apagada). Durante un foco, la cámara mira cada ~2 s, todo local, nada se
guarda ni sale del equipo. Si miras el teléfono (cabeza agachada sin usar el computador, o teléfono visible en la
mano), la mascota escala como un perro:
1. Apenas lo detecta → **"grrr"** (gruñido) y anim `oops`. Es solo un aviso: no cuenta como distracción. Si
   levantas la cabeza o vuelves a teclear, se calma (vuelve a `focus`) y no pasa nada más.
2. Si sigues distraído más de `barkAfterSec` (pref, default 3; el gruñido suena seguido hasta ahí) → **"bark bark"** (ladridos), `oops` de nuevo y
   recién ahí cuenta como distracción de F11 (`bundle = "phone"`). Mientras siga, ladra otra vez cada 4 s.
Si no hay cara durante `awayPauseSec` (pref, default 90) → el foco se pausa solo y Candolita queda en `sleep`; al
volver a verte, notificación "Pausé el foco cuando te fuiste" (no reanuda sola).
Cómo:
- Detección en la webview (no en Rust): `@mediapipe/tasks-vision` (dependencia nueva, justificada: no hay nada
  nativo que detecte objetos), `FaceLandmarker` con `outputFacialTransformationMatrixes: true` para presencia e
  inclinación de la cabeza (pitch sale de la matriz), y `ObjectDetector` (EfficientDet-Lite0, COCO, clase
  `cell phone`, score ≥ 0.5) para el teléfono a la vista. Modelos y `.wasm` copiados a `public/models/` (sin CDN en
  runtime). `getUserMedia` en `PetWindow` con un `<video>` fuera de pantalla; parar los tracks (`track.stop()`,
  apaga el LED) apenas el foco deja de estar `Running`.
- "Distraído" = (`pitch - base ≥ headDownDeg` (pref, default 12; medido: cabeza abajo ≈ +18°) durante ≥ 3 s **y** sin teclado ni mouse en ese
  rato) **o** teléfono visto en 2 muestras seguidas. `base` = mediana del pitch de las últimas ~30 muestras
  usando el computador (ventana móvil, se mantiene entre pausas) (input hace < 3 s; así mirar el teléfono al empezar no la ensucia). La cámara del usuario
  está en el monitor, de frente: base ≈ 0, pero se calibra igual por si cambia. Inactividad:
  comando Rust `input_idle_secs` con `CGEventSourceSecondsSinceLastEventType(CombinedSessionState,
  kCGAnyInputEventType)` (sin permiso de Accesibilidad). Falso positivo típico (leer papel en la mesa): el gruñido
  ya es el aviso; si molesta, el usuario sube `headDownDeg` o apaga la cámara.
- Sonidos: grabaciones CC0 (OpenGameArt, licencia anotada en `public/sounds/LICENSE`) en `public/sounds/growl.m4a`
  y `bark.m4a`. `sound.ts`: `clip(name)` que reusa el `music_cmd duck` de `chime` y reproduce con `new Audio()`,
  volumen propio (`CLIP_GAIN`, a oído). **Silencio durante una reunión** (captura de `meeting.rs` activa): ni
  gruñe ni ladra, solo anim, para no ladrarle al micrófono de la llamada.
- macOS: `NSCameraUsageDescription` en `src-tauri/Info.plist` (hoy solo está el micrófono). Si el usuario niega el
  permiso, la pref se apaga y Ajustes lo dice.
- Lógica pura en `src/lib/focusCam.ts`: `step(state, {face, pitch, phone, idleSecs, now}, prefs) → {state,
  event?}` con eventos `growl | bark | calm | away | back`. Test en `focusCam.test.ts`: cabeza abajo 3 s sin input
  → `growl`, con input → nada; teléfono 1 frame no dispara, 2 sí; volver antes de `barkAfterSec` → `calm` sin
  `bark`; pasado el umbral → `bark` una vez y de nuevo a los 30 s; calibración de `base`; ausencia corta no pausa,
  larga pausa una sola vez; volver → `back`.
- Eventos: `bark` → comando que emite `focus://distraction {bundle:"phone", name:"Teléfono"}` y suma en
  `session_apps` igual que F11 (el `growl` no se registra); ausencia → `timer_pause` + evento `focus://away`.
  `stateMachine`: `growl`/`bark` → `oops`, `calm` → `focus`, `away` → `sleep` (test).
- Ajustes → Timer: "Usar la cámara durante el foco", grados de "cabeza abajo", segundos hasta ladrar y segundos de
  ausencia antes de pausar.
Límites conocidos: COCO detecta mal el teléfono plano sobre la mesa o de canto (por eso manda la cabeza);
con poca luz falla la cara → `awayPauseSec` generoso. CPU: 2 inferencias cada 2 s en WebGL; medir con el Monitor
de Actividad y, si pesa, bajar a 1 cada 4 s.
Commit: `Cámara durante el foco: gruñe y ladra si miras el teléfono, pausa si te vas`

---------------------------------------------------------------------------------------------------------------
## Postergadas — no hacer por ahora
---------------------------------------------------------------------------------------------------------------

## F16. Sincronizar entre dispositivos — POSTERGADA
El timer ya guarda estado en epoch pensando en esto. Opción simple: la web local accesible en la LAN (bind
`0.0.0.0` solo si pref, HTTPS autofirmado, mismo token) para ver el timer y las tareas desde el celular. Opción
completa: sync de `pet.db` por un servidor propio con CRDT o last-write-wins por fila.
