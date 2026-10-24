# Desktop Pet

Mascota animada sobre el escritorio que funciona como timer de foco (Pomodoro) y organizador de tareas. También
escucha tus reuniones, las transcribe en local y te propone tareas, reproduce música (YouTube Music, Spotify o una
carpeta local) y tiene un chat con Claude Code. Tauri v2 (Rust) + React + Vite + TypeScript. macOS (prioridad) y Windows; Linux best effort.

## Requisitos

- Node 20+ y [pnpm](https://pnpm.io)
- Rust (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`) y luego `source ~/.cargo/env`
- macOS: Xcode Command Line Tools. Windows: WebView2 y Build Tools de Visual Studio.
- Reuniones: macOS 15 o superior, o Windows 10+ (para compilar: CMake y LLVM/clang). Para las tareas sugeridas sin API key, [Claude Code](https://claude.com/claude-code)
  instalado y con sesión iniciada (`claude` en el PATH, Homebrew o `~/.claude/local`).

## Desarrollo

```bash
pnpm install
pnpm tauri dev      # app en desarrollo (en dev hay un botón de 1 min en el panel)
pnpm test           # Vitest: máquina de estados, física, manifest, tareas, prefs
pnpm lint
cd src-tauri && cargo test   # timer, cortes de audio, decodificación PCM, limpieza de transcripciones
```

## Build

```bash
pnpm tauri build
```

- macOS → `src-tauri/target/release/bundle/dmg/*.dmg` (y `.app`)
- Windows → `src-tauri/target/release/bundle/msi/*.msi` (se genera construyendo en Windows)

En macOS el build se firma con **"Pet Local Signing"** (`bundle.macOS.signingIdentity`): un certificado propio en el llavero de login, solo para este Mac. Con firma estable macOS recuerda los permisos de Micrófono y Grabación de pantalla entre builds (con firma ad-hoc los vuelve a pedir en cada instalación). Sin hardened runtime ni notarización.
- Otro Mac: crear el certificado (`openssl req -x509` con `extendedKeyUsage=codeSigning`, importar el `.p12` con `security import … -T /usr/bin/codesign`) o borrar `signingIdentity` para volver a ad-hoc.
- Para distribuir: certificado *Developer ID* y notarizar (variables `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`; ver la guía de Tauri) y activar `hardenedRuntime` con el entitlement `com.apple.security.device.audio-input`.
- Windows: configura `bundle.windows.certificateThumbprint` en `tauri.conf.json`.

## Uso

- **Clic** en la mascota: abre el panel (Timer / Tareas / Reunión / Música / Chat). **Arrástrala** para moverla; al soltarla cae al borde inferior del monitor donde quedó.
- **Tray** (barra de menú): mostrar/ocultar mascota, iniciar foco, abrir tareas, ajustes, salir.
- **Captura rápida**: `Cmd/Ctrl+Shift+Space` (configurable en Ajustes) abre Tareas con el input enfocado.
- **Ajustes** (⚙ en el panel o tray): skin y tamaño, duraciones, sonido, atajo, inicio automático, calendario (iCal de
  Google), proveedores de LLM para reuniones y carpeta del chat con Claude Code.
- **Panel web**: http://127.0.0.1:4747 (botón ↗ del panel). Resumen del día, reuniones con búsqueda, tareas
  sugeridas, estadísticas de foco e historial del chat.

## Reuniones (macOS 15+ / Windows)

Panel → **Reunión** → **Empezar**. Transcribe tu micrófono como "Yo" y el audio de la llamada como "Otros", en tu equipo
con whisper.cpp (el modelo de ~550 MB se descarga la primera vez; en Windows corre en CPU, más lento). Al **Terminar** guarda la transcripción y propone
las tareas que te tocan; las apruebas con ✓ o las descartas con ✕.

- **Permisos**: la primera vez macOS pide *Micrófono* y *Grabación de pantalla y audio del sistema*. Si falta el de
  Micrófono la reunión no arranca y lo indica; actívalo en Ajustes del Sistema → Privacidad y seguridad → Micrófono.
- **Estado en vivo**: bajo el título se ve qué llega de cada fuente, por ejemplo
  `Escuchando · Yo 0:42 con voz · Otros 0:10 en silencio`. "sin audio" = de esa fuente no llega nada; "en silencio" =
  llega audio pero sin voz. Mientras Whisper procesa un fragmento dice `Transcribiendo 8 s de Yo…`. El texto aparece
  con unos segundos de retraso: se transcribe en fragmentos de 8 a 20 s cortados en una pausa.
- **Con audífonos funciona igual**: "Otros" se copia digitalmente del audio del sistema, salga por parlantes o
  audífonos. Con audífonos el micrófono solo te oye a ti, lo que evita el eco. Con audífonos Bluetooth como micrófono
  macOS baja la calidad; si "Yo" sale mal, elige el micrófono del Mac en Ajustes del Sistema → Sonido → Entrada.
- **Tareas sugeridas**: por defecto con `claude -p` de Claude Code (modelo `sonnet`), sin API key ni llamada propia a
  una API. En Ajustes → Reuniones se agregan más proveedores en orden de respaldo (Gemini, Claude API, OpenAI, Ollama o
  cualquier API compatible con OpenAI): si uno falla se prueba el siguiente. Las prefs guardadas antes de este cambio
  reciben `claude -p` en primer lugar sin perder sus proveedores.
- **Limpiar**: deja el panel en blanco para la próxima reunión. La transcripción guardada y las tareas sugeridas
  pendientes se mantienen. **Reintentar tareas de la última reunión** vuelve a mandarla al LLM.
- Las transcripciones quedan en `~/Library/Application Support/xyz.spadelab.pet/meetings/<epoch>.md`.

### Modo Gestión (ordenar tareas por voz)

En la misma pestaña, el selector **Reunión | Gestión**. Gestión escucha **solo el micrófono** (sin audio del sistema) y
sirve para dictar qué hacer con tus tareas: "la del contrato ya está, la propuesta pásala al jueves con prioridad alta y
agrégame revisar el deploy de pet con dos pomodoros". Al **Terminar**, el LLM recibe tus pendientes (con id) y la
fecha de hoy, y propone acciones **crear**, **editar** (título, proyecto, prioridad, fecha, pomodoros) o **completar**.
Cada propuesta muestra el cambio (`fecha 20 oct → 23 oct`, `✓ completar`) y no se aplica hasta que la apruebes con ✓.
Las fechas relativas ("el viernes") se resuelven con la fecha local; una tarea con fecha queda a las 9:00 de ese día.
La transcripción se guarda igual que una reunión (empieza con `# gestión`) y **Reintentar la última** la vuelve a mandar.

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
Opcionales: `voice` (texto de los llamados, ej. `{ "bark": "¡MIAU!", "growl": "FFFSSS" }`), `sounds` (audios `.m4a/.mp3/.wav/.ogg` del pack para `bark`/`growl`; sin ellos suenan los de `public/sounds`), `character` y `prompt` por animación (cómo se generó; se ven en Ajustes).
Para crear una mascota propia con una IA de imágenes: Ajustes → Personaliza tu mascota → "Descargar Genera Sprites Pet.md" (es [`examples/Genera Sprites Pet.md`](examples/Genera%20Sprites%20Pet.md)).
Los skins se guardan en el directorio de datos de la app (`~/Library/Application Support/xyz.spadelab.pet/skins/` en macOS).
La app no incluye personajes de terceros.

## Estructura

```
src-tauri/src/   lib.rs (ventanas, click-through) timer.rs tray.rs windows.rs db.rs
                 meeting.rs (captura, whisper, tareas sugeridas) claude.rs (chat) music.rs web.rs (panel web)
src/pet/         mascota: stateMachine.ts physics.ts Sprite.tsx PetWindow.tsx
src/panel/       panel: timer, tareas, reunión, música, chat
src/web/         panel web (también la ventana Tareas de la app)
src/settings/    ventana de ajustes (incluye el editor de LLMs)
src/skins/       schema (zod) y loader
src/store/       zustand: timer, tareas, ajustes
```

Detalles de plataforma y workarounds: [NOTES.md](NOTES.md). Avance por fases: [PROGRESS.md](PROGRESS.md).
