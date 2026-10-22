# PROGRESS

## F1: Ventana mascota — hecha (pendiente verificación visual del usuario)
- Ventana `pet` transparente, sin bordes, siempre al frente, sin taskbar/sombra.
- Click-through por polling en Rust sobre el rect del sprite; arrastre con `startDragging`.
- Sprite placeholder SVG (zorro) con animación idle CSS.

## F2: Movimiento y estados — hecha
- `stateMachine.ts` y `physics.ts` puros con tests; loop rAF en `PetWindow`; work area vía `currentMonitor()`; multi-monitor al soltar.

## F3: Timer — hecha (pendiente verificación visual)
- `timer.rs`: timer en Rust (hilo 250 ms, `Instant`), eventos `timer://tick` y `timer://done`, foco -> pausa automática (larga cada 4). Tests con `cargo test`.
- Notificación nativa desde Rust al terminar (funciona con ventanas ocultas).
- Píldora bajo la mascota (color por modo, parpadea en pausa); panel anclado sobre la mascota con controles, 5/15/30 y minutos custom (+1 min solo en dev).
- Clic en la mascota abre/cierra el panel; arrastre empieza al mover > 3 px.
- Un foco que vence con la app cerrada se registra a su hora real (`Timer::catch_up` al restaurar), no a la de reabrir la app.

## F4: Tareas — hecha (pendiente verificación del usuario)
- SQLite (`tauri-plugin-sql`, migración `src-tauri/migrations/001_init.sql`, preload en `tauri.conf.json`): categorías, tareas, sesiones.
- Panel con pestañas Timer / Tareas: CRUD (doble clic para renombrar), categorías editables (⚙), prioridad, estimación, fecha/hora, filtro Hoy y contador de focos del día.
- 🎯 enfoca una tarea: el timer la lleva en Rust (`task_id`) y al terminar cada foco suma pomodoros reales y guarda la sesión.
- Atajo global `Cmd/Ctrl+Shift+Space` (Rust): abre/cierra el panel en la pestaña donde quedó.
- Recordatorios: la ventana mascota revisa cada 20 s tareas con fecha vencida y notifica una vez (`send_notification`).
- Completar una tarea hace celebrar a la mascota.

## F5: Skins — hecha (pendiente verificación del usuario)
- `skins/schema.ts` (zod + `resolveAnim` con respaldo a idle + pack de imagen única) y `loader.ts` (lista, carga con blob URLs, import de carpeta / .zip / imagen). Tests en `schema.test.ts`.
- Skins en `$APPDATA/skins/<id>/`; skin original integrado (zorro SVG). Activo guardado con `tauri-plugin-store`; cambio en caliente por evento `settings://skin`.
- Ventana `settings` (⚙ en el panel): elegir, importar y quitar skins. Ejemplo para probar: `examples/slime-demo/`.
- `walkSpeed`, `groundOffset` y `scale` del manifest se aplican; el sprite se limita a 150 px por la ventana fija de la mascota.

## F6: Pulido — hecha en Mac (pendiente verificación visual y build en Windows)
- Tray (`tray.rs`): mostrar/ocultar mascota, iniciar foco, abrir tareas, ajustes, salir.
- Ajustes completos: duraciones (foco, pausas, pausa larga cada N), sonido (campanilla WebAudio + botón Probar), atajo global configurable (captura de teclas, validado en Rust), autostart (LaunchAgent).
- Preferencias validadas con zod (`lib/prefs.ts`, con tests) y empujadas a Rust (`timer_config`).
- Ícono original (zorro) generado y aplicado con `pnpm tauri icon`. README con instrucciones de build y firma.
- El `.msi` solo se puede generar construyendo en Windows.

## Extra: skin "Tortu" (tortuga original)
- `examples/tortu/`: pixel art propio con las 6 animaciones (idle, walk, focus, celebrate, sleep, dragged); `generate.py` lo regenera.
- Test que valida que los manifests de `examples/` parsean y sus archivos existen.

## Extra: ciclo automático
- Pref `autoCycle` (Ajustes, por defecto activo): al terminar una pausa arranca el siguiente foco solo, conservando la tarea del foco anterior; la pausa larga sigue cada N focos.
- Notificación en cada cambio ("Suelta el trabajo: pausa de N min" / "A trabajar: foco de N min") y sonido distinto: sube al descansar, baja al volver a trabajar.
- Sonido: campanilla WebAudio a volumen fijo, sin tocar el volumen del sistema (el peak molestaba). Mientras suena, YouTube Music baja al 7 % en fundido (`duck`) y vuelve a subir a los 3 s. Pre-aviso del cambio de ciclo: un tick a los 10 s y uno por segundo en los últimos 5.

## Extra: YouTube Music integrado (solo macOS)
- Ventana "music" (WKWebView con UA de Safari) con music.youtube.com; se crea oculta al arrancar la app (sin reproducir) y cerrarla la oculta, la música sigue.
- Sin IPC para la web: `music_bridge.js` (initialization script) publica el estado en `document.title` (Rust lo reenvía como `music://state` vía `on_document_title_changed`) y recibe comandos por `eval` -> `window.__pet(cmd, arg)`.
- Controles: reproducir/pausar (elemento `<video>`), siguiente/anterior (manejadores de `mediaSession` capturados, porque los botones de YTM viven en shadow DOM), volumen (`movie_player.setVolume`), posición, búsqueda.
- Probado a mano en la app: estado, pausa, siguiente, volumen, seek, búsqueda, duck y títulos largos. Frágil ante cambios del DOM de YouTube Music: si algo deja de responder, revisar `music_bridge.js`.
- Cola "A continuación": `music_bridge.js` lee `ytmusic-player-queue-item` (los 12 siguientes al seleccionado) y los publica en el estado (`q`); el panel los lista y al hacer clic salta a esa canción (`jump`).
- Panel más alto (640 px; `PANEL_H` y `tauri.conf.json`) para ver más de la cola.
- Modo atención: Rust emite `panel://visible` al abrir/cerrar el panel (`show_panel`, blur, `toggle_panel`, comando `hide_panel` del ✕). La mascota pasa a `attention` (quieta, anim idle + "perk"), no camina ni se duerme; al cerrar vuelve a idle. Si estaba en foco/pausa se queda como está, y si algo la deja libre con el panel abierto (celebrate, arrastre, fin de pausa) cae en `attention` en vez de idle. Cubierto por tests en `stateMachine.test.ts`.

## Extra: calendario (Google, solo lectura)
- Ajustes → Calendario: "Dirección secreta en formato iCal" de Google Calendar (pref `icalUrl`).
- Rust `fetch_ical` baja el `.ics` con el `curl` del sistema (desde el webview lo frena CORS); la mascota lo refresca cada 5 min.
- `lib/calendar.ts` (ical.js): ocurrencias de las próximas 24 h con RRULE, EXDATE, excepciones y VTIMEZONE; sin día completo ni canceladas. Tests en `calendar.test.ts`.
- Aviso 2 min antes de cada reunión: notificación + campanilla.
- Pendiente: sugerir tareas desde Gmail.

## Extra: escuchar reuniones (solo macOS 15+)
- Panel → pestaña Reunión → "Escuchar reunión". Todo vive en Rust (`meeting.rs`); el panel solo muestra `meeting://state`.
- Durante la reunión solo se transcribe (sin LLM): ScreenCaptureKit captura a la vez el micrófono ("Yo") y el audio del sistema ("Otros") a 16 kHz mono; fragmentos de 8–20 s cortados en un silencio (`take_chunk`), sin transcribir los mudos y filtrando alucinaciones típicas de whisper (`clean`).
- whisper.cpp local (`whisper-rs` con Metal, `ggml-large-v3-turbo-q5_0`, ~550 MB, se descarga la primera vez a `$APPDATA/models`): ~2 s por 8 s de audio en un M5.
- Al terminar: guarda la transcripción en `$APPDATA/meetings/<epoch>.md`, la limpia (`condense`: muletillas, repeticiones, eco de la llamada en el micrófono, une líneas del mismo hablante) y hace UNA llamada a un LLM (Ajustes → Reuniones; por defecto `claude -p` de Claude Code, modelo `sonnet`, sin API key; también Gemini, Claude API, OpenAI, Ollama o cualquier API compatible con OpenAI). Las tareas llegan al panel con ✓ (crea la tarea) / ✕ y una notificación.
- Sin diarización: Yo/Otros sale del canal de audio.
- Pruebas manuales: `probar_whisper` y `probar_llm` (tests `#[ignore]` en `meeting.rs`, ver su doc). Con una reunión de ejemplo, `qwen3.5:9b` local sacó 5/5 tareas sin falsos positivos en 85 s.
- El hilo que transcribe suelta el candado de `bufs` antes de llamar a whisper: el callback de ScreenCaptureKit no espera y se perdía audio (huecos en la transcripción).
- `claude -p` con límite de 5 min (si se cuelga se mata y se prueba el siguiente modelo) y lanzado por el zsh de login del usuario (`claude::command`, compartido con el chat), así encuentra también el `claude` de `~/.local/bin`.

## Extra: chat con Claude Code
- Panel → Chat: input estilo CLI que corre `claude -p --output-format stream-json` (`claude.rs`) en la carpeta base (Ajustes → Chat con Claude Code; vacía = home, ahí lee su CLAUDE.md). Prompt por stdin; zsh de login para heredar el PATH.
- Permisos: por defecto solo lectura (`READ_ONLY`: docker ps/stats/inspect/logs, ps, vm_stat…). Lo que Claude intente fuera de eso vuelve en `permission_denials` → el panel muestra "Quiere ejecutar…" con "Sí, hazlo", que reanuda la sesión (`--resume`) permitiendo exactamente esos comandos. Switch "Modo dios" (`--dangerously-skip-permissions`), no se guarda.
- Historial: tabla `chat_log` (migración 3): prompt, respuesta, herramientas usadas, resultado y si fue en modo dios. El chat muestra las últimas 30 y retoma la última sesión.
- Mascota: `claude://start` → `work` (Candolita sentada al escritorio con gafas tecleando); al terminar `mission` (bandera ✓), `oops` (nube de tormenta) o `ask` (globito "?" hasta 60 s). Skins sin esas animaciones caen a focus/celebrate/idle.

## Extra: Candolita más expresiva y tamaño configurable
- Caras dibujadas a mano en `generate.py` (`EYES`, `BROWS`, `mouth`, rubor, orejas que se paran/caen): cada animación tiene su expresión (decidida en foco, sorpresa al arrastrarla, triste en oops, ceja levantada en ask…).
- Guitarra de pie sobre las patas traseras (`upright`) y animación nueva `headbang` (cabezazo con pata y cuernos), que entra en la rotación con música (`ROCK` en `schema.ts`).
- Leer y escribir sentada en la silla (`seated`, compartido con `work`): libro entre las patas / lápiz sobre el escritorio.
- Ajustes → Skin → "Tamaño en pantalla" (pref `petSize`, 64–320 px, por defecto 128): fija el alto del sprite y la ventana de la mascota se redimensiona sola (`core:window:allow-set-size`).

## Extra: panel web completo
- La web local (http://127.0.0.1:4747, en dev 4748 vía localhost:1420) y la ventana Tareas de la app muestran el mismo panel (`src/web/`), con rutas por hash (`#meetings/<id>`).
- Resumen: timer en vivo con controles (sin `seconds` usa la duración de Ajustes), música, focos/tiempo de hoy, racha, 14 días, tareas para hoy y sugerencias pendientes.
- Reuniones: búsqueda con resaltado en todas las transcripciones, filtro Yo/Otros, copiar/descargar .md, empezar/terminar reunión y "Buscar tareas de nuevo" por reunión (`meeting_retry` con `id`).
- Sugerencias: las tareas del LLM ahora se guardan en `meeting_tasks` (migración 4) con estado pendiente/aceptada/descartada; título editable, proyecto al aceptar, aceptar/descartar todas, recuperar descartadas. El panel de la mascota lee de la misma tabla.
- Foco: por día (7/30/90), por proyecto/categoría/tarea, por hora del día y lista de sesiones borrables. Chat: historial de `chat_log` con búsqueda. Respaldo JSON de todo (solo navegador).
- La web llama comandos de la app por `POST /api/invoke` (`web.rs`, lista cerrada); los de reunión usan los LLMs de `settings.json`, así las API keys no pasan por el navegador.

## Lote features — carril C
- F8 Tareas recurrentes: migración 007 (`tasks.repeat`: none/daily/weekdays/weekly/monthly). Completar pasa por `db.rs::task_set_done` (panel, web y `acceptSuggestion`, vía `db.setDone` → `call`), que marca la tarea y crea la siguiente con `next_due` (misma hora, `notified = 0`; vencida hace días salta al primer vencimiento futuro; mensual recorta a fin de mes). Registrado en `generate_handler!` y en la lista de `web.rs::invoke`, para que el MCP (F9) tampoco se salte la recurrencia. Selector "Repetir" en el panel y el gestor, ícono ↻ en la lista. Tests: `next_due` y el flujo completo sobre SQLite en memoria. Pendiente de verificación visual (panel y gestor).
- F6 Informe de horas por proyecto: web → Informe (esta semana / semana pasada / este mes / fechas), tabla proyecto × día con total por proyecto y por día, "sin proyecto" al final, redondeo opcional a 15 min por celda y export CSV / Markdown (`download()`). `db.focusByProjectDay` trae las sesiones con `s.end > from AND s.start < to`; `stats.ts::pivot` reparte la que cruza medianoche y recorta la que se sale del rango. Tests de `pivot`, `roundTo`, rangos y exportación. Pendiente de verificación visual.
