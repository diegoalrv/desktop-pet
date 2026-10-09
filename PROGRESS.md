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
