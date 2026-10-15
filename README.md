# Desktop Pet

Mascota animada sobre el escritorio que funciona como timer de foco (Pomodoro) y organizador de tareas.
Tauri v2 (Rust) + React + Vite + TypeScript. macOS (prioridad) y Windows; Linux best effort.

## Requisitos

- Node 20+ y [pnpm](https://pnpm.io)
- Rust (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`) y luego `source ~/.cargo/env`
- macOS: Xcode Command Line Tools. Windows: WebView2 y Build Tools de Visual Studio.

## Desarrollo

```bash
pnpm install
pnpm tauri dev      # app en desarrollo (en dev hay un botón de 1 min en el panel)
pnpm test           # Vitest: máquina de estados, física, manifest, tareas, prefs
pnpm lint
cd src-tauri && cargo test   # lógica del timer
```

## Build

```bash
pnpm tauri build
```

- macOS → `src-tauri/target/release/bundle/dmg/*.dmg` (y `.app`)
- Windows → `src-tauri/target/release/bundle/msi/*.msi` (se genera construyendo en Windows)

Los instaladores salen **sin firmar**. Para distribuirlos:
- macOS: firma con un certificado *Developer ID* y notariza (variables `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`; ver la guía de Tauri). Sin firma, abre con clic derecho → Abrir.
- Windows: configura `bundle.windows.certificateThumbprint` en `tauri.conf.json`.

## Uso

- **Clic** en la mascota: abre el panel (Timer / Tareas). **Arrástrala** para moverla; al soltarla cae al borde inferior del monitor donde quedó.
- **Tray** (barra de menú): mostrar/ocultar mascota, iniciar foco, abrir tareas, ajustes, salir.
- **Captura rápida**: `Cmd/Ctrl+Shift+Space` (configurable en Ajustes) abre Tareas con el input enfocado.
- **Ajustes** (⚙ en el panel o tray): skin, duraciones, sonido, atajo e inicio automático.

## Skins

Un skin es una carpeta o `.zip` con `manifest.json` y sprite sheets horizontales. Importa desde Ajustes → "Importar carpeta…" / "Importar .zip / imagen…".
Una sola imagen también sirve: se anima con efectos CSS. Hay ejemplos en `examples/`: `tortu` (tortuga original con las 6 animaciones; `generate.py` la regenera), `candolita` (perrita negra con pañoleta, mismas animaciones) y `slime-demo`.

```json
{
  "id": "mi-skin",
  "name": "Mi skin",
  "frameWidth": 128,
  "frameHeight": 128,
  "scale": 1,
  "animations": {
    "idle": { "file": "idle.png", "frames": 6, "fps": 8, "loop": true },
    "walk": { "file": "walk.png", "frames": 8, "fps": 12, "loop": true }
  },
  "walkSpeed": 40,
  "groundOffset": 0
}
```

Animaciones: `idle` (obligatoria), `walk`, `focus`, `celebrate`, `sleep`, `dragged`; las que falten usan `idle`.
Los skins se guardan en el directorio de datos de la app (`~/Library/Application Support/xyz.spadelab.pet/skins/` en macOS).
La app no incluye personajes de terceros.

## Estructura

```
src-tauri/src/   lib.rs (ventanas, click-through) timer.rs tray.rs windows.rs
src/pet/         mascota: stateMachine.ts physics.ts Sprite.tsx PetWindow.tsx
src/panel/       panel de timer y tareas
src/settings/    ventana de ajustes
src/skins/       schema (zod) y loader
src/store/       zustand: timer, tareas, ajustes
```

Detalles de plataforma y workarounds: [NOTES.md](NOTES.md). Avance por fases: [PROGRESS.md](PROGRESS.md).
