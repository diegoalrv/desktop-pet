# NOTES

- **macOS transparencia**: requiere `app.macOSPrivateApi: true` en `tauri.conf.json` + feature `macos-private-api` en `Cargo.toml`.
- **Click-through**: `set_ignore_cursor_events` solo se activa desde Rust con polling del cursor (60 ms) contra un rect
  reportado por el frontend (`set_hit_rect`). Con ignore=true el webview no recibe mouse, por eso el hit-test vive en Rust.
- **Dock**: `ActivationPolicy::Accessory` (sin ícono en el dock).
- Rust se instaló con rustup (perfil minimal); `source ~/.cargo/env` antes de `pnpm tauri dev`.
