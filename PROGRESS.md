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

## F4: Tareas — hecha (pendiente verificación del usuario)
- SQLite (`tauri-plugin-sql`, migración `src-tauri/migrations/001_init.sql`, preload en `tauri.conf.json`): categorías, tareas, sesiones.
- Panel con pestañas Timer / Tareas: CRUD (doble clic para renombrar), categorías editables (⚙), prioridad, estimación, fecha/hora, filtro Hoy y contador de focos del día.
- 🎯 enfoca una tarea: el timer la lleva en Rust (`task_id`) y al terminar cada foco suma pomodoros reales y guarda la sesión.
- Atajo global `Cmd/Ctrl+Shift+Space` (Rust): abre el panel en Tareas con el input enfocado.
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
- Sonido fuerte: campanilla a ganancia 1.0, onda triangular, arpegio x2; pref `loud` (por defecto activa) sube el volumen del sistema a 100 y quita el mute mientras suena (macOS vía osascript, comando `boost_volume`) y lo restaura a los 3 s. Silenciar otras apps no es posible en macOS sin extensiones; se cubre con el volumen máximo.

## Extra: YouTube Music integrado (solo macOS)
- Ventana "music" (WKWebView con UA de Safari) con music.youtube.com; se crea oculta al arrancar la app (sin reproducir) y cerrarla la oculta, la música sigue.
- Sin IPC para la web: `music_bridge.js` (initialization script) publica el estado en `document.title` (Rust lo reenvía como `music://state` vía `on_document_title_changed`) y recibe comandos por `eval` -> `window.__pet(cmd, arg)`.
- Controles: reproducir/pausar (elemento `<video>`), siguiente/anterior (manejadores de `mediaSession` capturados, porque los botones de YTM viven en shadow DOM), volumen (`movie_player.setVolume`), posición, búsqueda.
- La campanilla del cambio de ciclo silencia la música 3 s (`duck`) mientras sube el volumen del sistema.
- Probado a mano en la app: estado, pausa, siguiente, volumen, seek, búsqueda, duck y títulos largos. Frágil ante cambios del DOM de YouTube Music: si algo deja de responder, revisar `music_bridge.js`.
- Cola "A continuación": `music_bridge.js` lee `ytmusic-player-queue-item` (los 12 siguientes al seleccionado) y los publica en el estado (`q`); el panel los lista y al hacer clic salta a esa canción (`jump`).
- Panel más alto (640 px; `PANEL_H` y `tauri.conf.json`) para ver más de la cola.
- Modo atención: Rust emite `panel://visible` al abrir/cerrar el panel (`show_panel`, blur, `toggle_panel`, comando `hide_panel` del ✕). La mascota pasa a `attention` (quieta, anim idle + "perk"), no camina ni se duerme; al cerrar vuelve a idle. Si estaba en foco/pausa se queda como está, y si algo la deja libre con el panel abierto (celebrate, arrastre, fin de pausa) cae en `attention` en vez de idle. Cubierto por tests en `stateMachine.test.ts`.
