# NOTES

- **macOS transparencia**: requiere `app.macOSPrivateApi: true` en `tauri.conf.json` + feature `macos-private-api` en `Cargo.toml`.
- **Click-through**: `set_ignore_cursor_events` solo se activa desde Rust con polling del cursor (60 ms) contra un rect
  reportado por el frontend (`set_hit_rect`). Con ignore=true el webview no recibe mouse, por eso el hit-test vive en Rust.
- **Dock**: `ActivationPolicy::Accessory` (sin ícono en el dock).
- Rust se instaló con rustup (perfil minimal); `source ~/.cargo/env` antes de `pnpm tauri dev`.
- **Cursor en macOS multi-monitor**: `cursor_position()` de tao usa la escala del monitor primario y falla con DPI mixto;
  se usa `NSEvent.mouseLocation` + `NSWindow.frame` (mismo espacio de puntos) en `cursor_in_window`.
- **Notificaciones en dev (macOS)**: sin bundle propio pueden no mostrarse o salir como "Terminal"; se validan con `pnpm tauri build`.
- **Clic vs arrastre**: `startDragging()` bloquea el `mouseup`, así que solo se llama tras mover > 3 px; un clic sin mover abre el panel.
- **SQLite con varias ventanas**: si cada ventana hace `Database.load` a la vez, las migraciones chocan (`database is locked`).
  Se evita con `plugins.sql.preload` en `tauri.conf.json`: Rust abre y migra una vez; los `load` de JS reutilizan el pool.
- **Skins**: las imágenes se leen con `plugin-fs` y se sirven como blob URLs (no hace falta asset protocol ni CSP). Los nombres de archivo del manifest
  son planos (`^[\w.-]+\.(png|webp|gif|jpe?g)$`) para evitar path traversal desde un zip. Rutas elegidas por diálogo se agregan solas al scope de fs.
- **Sonido**: WebAudio desde el webview; si WKWebView lo bloquea por autoplay, el botón "Probar" de Ajustes (gesto del usuario) lo confirma.
- **Tray**: usa el ícono de la app (no template); en barra clara/oscura de macOS puede verse menos nítido que un ícono monocromo.
