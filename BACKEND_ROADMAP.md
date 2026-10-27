# BACKEND ROADMAP

Tracking del backend de la Candola en el VPS. Fuente única: FEATURES.md (F19 "Después", F20, F21) apunta acá.
Marcar `[x]` al terminar cada tarea y anotar la fecha; decisiones nuevas van al registro del final.

Estado al 27-oct-2026: **diseño cerrado, nada construido**. Lo único en producción es LiteLLM (`ai.spadelab.xyz`).

---------------------------------------------------------------------------------------------------------------
## Principio
---------------------------------------------------------------------------------------------------------------

La app es **local-first**. El backend solo hace lo que un equipo no puede hacer solo: dar acceso a la IA,
identificar al usuario, cobrar, recibir errores y uso, y repartir la app. Los datos del usuario no suben (sync es
F16, postergada).

| Se queda en el equipo | Va al VPS |
|---|---|
| `pet.db` (tareas, sesiones, rutinas, reuniones) | Acceso a LLMs (LiteLLM) |
| Transcripción (whisper + Silero VAD) | Embeddings (cálculo, no almacenamiento) |
| Timer, cámara, distracciones, voz | Usuarios, invitaciones, login |
| API local `web.rs` y MCP (`mcp/`) | Cobro (Transbank) |
| Índice de reuniones (`meeting_chunks`) | Errores (GlitchTip) y eventos de uso |

---------------------------------------------------------------------------------------------------------------
## Stack
---------------------------------------------------------------------------------------------------------------

Todo en **Coolify**, desplegado siempre por la API de Coolify. No Railway: LiteLLM y su BD ya viven acá, los
embeddings necesitan RAM del VPS y las llamadas entre servicios van por la red interna `coolify` (compartida por
todos los proyectos del servidor), sin exponer keys de administración.

Dos proyectos separados:
- **`ai-proxy` — gateway de LLM, independiente de cualquier producto.** LiteLLM, su Postgres y el modelo de
  embeddings. Sirve a la Candola y a los productos que vengan, cada uno como un *team* de LiteLLM.
- **`candola` — todo lo propio de la Candola.** candola-api, su Postgres (bases `candola` y `glitchtip`) y GlitchTip.
  La web va en Vercel.

```
                                   VPS (Coolify)
                 ┌───────────────────────────────────────────────────┐
                 │ proyecto ai-proxy (compartido)                     │
App Candola ─────┼──▶ LiteLLM ── Anthropic / DeepSeek / …             │
(Mac/Win)        │      │  teams: candola · <otros productos>         │
  IA: key del    │      ├── embed-e5 (multilingual-e5-small)          │
  team candola   │      └── Postgres (litellm)                        │
                 └──────▲────────────────────────────────────────────┘
                        │ red interna coolify (key de gestión del team candola)
                 ┌──────┴────────────────────────────────────────────┐
  Vercel         │ proyecto candola                                   │
  site/ ── POST ─┼──▶ candola-api (auth, invitaciones, keys, /v1/me,  │
App: /v1/me, ────┼──▶   /v1/events, Transbank)                        │
  eventos        │    GlitchTip ◀── errores de la app (opt-in)        │
                 │    Postgres 16 (candola · glitchtip)               │
                 └───────────────────────────────────────────────────┘
```

| Proyecto | Pieza | Qué | Estado |
|---|---|---|---|
| ai-proxy | LiteLLM | Gateway de LLM: modelos base, alias por producto, fallbacks, teams, keys, presupuestos | ✅ En producción (v1.104.5); team `candola` y 4 alias `candola-*` listos (27-oct); la app aún pide `candola` |
| ai-proxy | Postgres 16 (`litellm-db`) | Base de LiteLLM | ✅ Respaldo diario (27-oct) |
| ai-proxy | embed-e5 | `multilingual-e5-small` (384 dim) con text-embeddings-inference o Ollama; modelo base `embed-e5` | ❌ |
| candola | candola-api | TypeScript + Hono (Node 22), `postgres` (postgres.js), migraciones SQL numeradas, zod, Better Auth. Carpeta `server/` del repo, Dockerfile | ❌ |
| candola | Postgres 16 | Un servidor, bases `candola` y `glitchtip` con usuarios propios. Sin vector DB: si algún día el servidor busca, `pgvector` acá | ✅ `candola-db` con base `candola` y respaldo diario (27-oct); falta `glitchtip` |
| candola | GlitchTip | Errores (compatible con Sentry). Es multiproyecto: otro producto puede usarlo como proyecto aparte | ⚠️ Corre fuera de Coolify (`docker compose`, Postgres 15 + Redis propios) |
| Vercel | Web | `site/`, autodeploy por GitHub. Mínima; el diseño después con Claude Design | ❌ |
| — | Correo | Resend | Pendiente, aún no hace falta |

### LiteLLM: modelos base, teams y misiones
- **Modelos base** (compartidos, no los pide ninguna app directo): `claude-haiku`, `claude-sonnet`, `deepseek-flash`,
  `gemini-flash`, `embed-e5`, etc.
- **Un team por producto** (`candola`, después otros): presupuesto propio, solo puede usar sus alias, y el gasto se
  ve por producto. Las keys de usuarios cuelgan del team.
- **Alias por producto** sobre los modelos base: la app nombra la misión y LiteLLM elige el modelo y el respaldo
  (`fallbacks` del router). Cambiar el modelo de una misión de la Candola no toca a otros productos. Los prompts se
  quedan en la app (van amarrados al parseo de la respuesta).

| Alias (team `candola`) | Misión | Prompt en la app | Hoy |
|---|---|---|---|
| `candola-chat` | Chat con herramientas | `candola.md` | `candola` + reintento a `deepseek-flash` en `ai_chat` |
| `candola-reuniones` | Reunión → resumen, decisiones, tareas | `PROMPT` (`meeting.rs`) | `candola-reuniones` + `deepseek-flash` (`ai::for_meeting`) |
| `candola-gestion` | Dictado → acciones sobre tareas | `MANAGE_PROMPT` | `candola` + `deepseek-flash` (`ai::chain`) |
| `candola-preguntas` | Preguntarle a las reuniones | `ASK_PROMPT` | `candola` + `deepseek-flash` |
| `candola-embed` | Embeddings | — | `titan-embed-v2` (**caído**: AWS bloqueó Bedrock) |

- **Acceso de candola-api a LiteLLM**: con una key de gestión limitada al team `candola` (crear/actualizar keys
  solo de ese team), no con la master key. Verificar qué permite v1.104.5 (parte de la gestión por team puede ser
  enterprise). Si no alcanza: master key solo en candola-api, que únicamente toca keys de su team, y anotarlo como
  deuda.
- **Actualizar LiteLLM afecta a todos los productos**: versión fijada y probar antes de subirla.

---------------------------------------------------------------------------------------------------------------
## Fases
---------------------------------------------------------------------------------------------------------------

### Fase 1 — Infra base
- [x] 2 GB de swap en el VPS (`/swapfile`, `fstab`, `swappiness=10`) — 27-oct-2026
- [x] `ai-proxy`: respaldo diario del Postgres de LiteLLM (07:30 UTC, 14 copias locales; restauración probada en BD temporal) — 27-oct-2026
- [x] `ai-proxy`: team `candola` en LiteLLM (US$20/30 d); keys de testers nuevas en ese team (las viejas, sin team, bloqueadas; falta borrarlas) — 27-oct-2026
- [ ] `ai-proxy`: key de gestión del team `candola` (o decidir la alternativa, ver arriba)
- [x] Proyecto `candola` en Coolify con Postgres 16 `candola-db` (base y usuario `candola`; la base `glitchtip` va con la migración de GlitchTip) — 27-oct-2026
- [ ] GlitchTip: revisar si tiene datos, pasarlo al proyecto `candola` con su base en ese Postgres, bajar el compose viejo
- [x] `candola`: respaldo diario del Postgres (08:00 UTC, 14 copias locales; restauración probada) — 27-oct-2026

Hecho cuando: los dos proyectos aparecen en Coolify con respaldos probados, y las keys de testers están en el team
`candola`.

### Fase 2 — Misiones (corte de una vez)
- [x] LiteLLM: modelos base con nombres genéricos (los de hoy ya lo son: `claude-haiku`, `deepseek-flash`) — 27-oct-2026
- [x] LiteLLM: los 4 alias `candola-*` (chat, reuniones, gestion, preguntas) → `claude-haiku`, permitidos solo al team `candola` (`candola-embed` queda para la Fase 8) — 27-oct-2026. Ver `infra/litellm/README.md`
- [x] LiteLLM: `fallbacks` en el router (`candola-*` → `deepseek-flash`) — 27-oct-2026
- [ ] App (`ai.rs`): pedir solo misiones; fuera `BACKUP`, `for_meeting` y el reintento de `ai_chat`; tests
- [ ] Publicar versión (tag → CI de Windows)
- [x] Keys de testers nuevas con solo las misiones; borrados el alias `candola`, los `bench-*` y `titan-embed-v2` — 27-oct-2026. Pendiente menor: borrar (no solo bloquear) las 3 keys viejas y decidir sobre `prueba-diego` (ver README)
- [ ] Verificar con una key de tester: reunión, gestión, pregunta, chat

Hecho cuando: las keys de testers solo conocen misiones y las 4 funciones andan con la versión nueva.

### Fase 3 — candola-api base
- [ ] Esqueleto `server/`: Hono, postgres.js, migraciones, zod, Dockerfile, `/health`
- [ ] Despliegue por la API de Coolify en el proyecto `candola`, `api.candola.spadelab.xyz` (o similar; DNS gris en Cloudflare)
- [ ] Llega a LiteLLM por la red interna `coolify` con la key de gestión del team
- [ ] Better Auth con código al correo (mientras no haya Resend: código visible en logs/pantalla solo en integración)
- [ ] Invitaciones: `POST /admin/invites` (token de admin), código de un uso con vencimiento
- [ ] Registro con invitación → usuario (UUID opaco) + key en el team `candola` (`/key/generate`, misiones, presupuesto gratis, `metadata.user_id`)
- [ ] Código de dispositivo: `POST /v1/device` y `POST /v1/device/token`
- [ ] `GET /v1/me` (Bearer = key de LiteLLM): id, plan, presupuesto usado/restante, estado de pago, avisos
- [ ] `POST /v1/events` en lote, rate limit, tope de tamaño, borrado a los 90 días
- [ ] Tests de la lógica pura (invitaciones, validación de eventos)

Hecho cuando: con una invitación se crea un usuario con key que funciona contra LiteLLM, y `/v1/me` lo devuelve.

### Fase 4 — Cobro (Transbank Oneclick Mall)
Webpay Plus no hace cobros recurrentes: se usa Oneclick Mall (inscribir tarjeta + cobro mensual propio).
- [ ] Integración con `transbank-sdk` y códigos de prueba
- [ ] Inscripción de tarjeta (inicio → retorno → guardar `tbk_user`)
- [ ] Cron mensual: cobra $5.000 CLP; OK → `/key/update` renueva el presupuesto del plan; falla → tope gratis
- [ ] Reintento de cobro fallido y aviso en `/v1/me`
- [ ] Baja de suscripción (borrar inscripción)
- [ ] Producción: variables en Coolify `TBK_COMMERCE_CODE`, `TBK_CHILD_COMMERCE_CODE`, `TBK_API_KEY` (los pone Diego cuando Transbank apruebe)

Hecho cuando: en integración, una tarjeta de prueba se inscribe, se cobra y la key cambia de presupuesto.

### Fase 5 — Web mínima (Vercel)
- [ ] `site/` enlazado a GitHub (push a `master` → producción)
- [ ] Descarga: última release de GitHub (Mac `.dmg`, Windows `.exe`), aviso de Gatekeeper/SmartScreen
- [ ] Registro con invitación, login, plan y pago (llaman a candola-api; CORS solo del dominio y previews)
- [ ] Página de confirmación del código de dispositivo

Hecho cuando: un invitado se registra, descarga, inscribe la tarjeta (integración) y entra desde la app.

### Fase 6 — App: cuenta
- [ ] Login con código de dispositivo (Ajustes → Asistente): muestra el código, abre el navegador, recibe la key
- [ ] Comando Rust `account_get` → `/v1/me` (la key no pasa por el front; sin CORS)
- [ ] Panel: plan, presupuesto restante, estado de pago
- [ ] Quitar el campo de pegar la key

### Fase 7 — Telemetría en la app
- [ ] Sentry SDK en Rust (panic hook) y JS (`onerror`, `unhandledrejection`) → GlitchTip (proyecto `candola`)
- [ ] `release` = versión, `environment` = SO, `user.id` = UUID; `beforeSend` limpia rutas y textos
- [ ] Eventos de uso → `/v1/events` (cola local con reintento, envío en lote, sin bloquear la UI)
- [ ] Opt-in: aviso al registrarse + interruptor en Ajustes; apagado = ni una petición
- [ ] Fallos de IA, reuniones y cámara como eventos/errores

Hecho cuando: un crash provocado en una build de prueba aparece en GlitchTip con versión, SO y UUID, sin datos personales.

### Fase 8 — Embeddings (búsqueda híbrida)
Urgente en la práctica: desde el 27-oct `titan-embed-v2` responde "Error 002" y preguntarle a las reuniones no anda
en Windows. El paso 1 no necesita el VPS y se puede adelantar.
- [ ] **FTS5 en la app**: tabla virtual sobre el texto de `meeting_chunks`, llenada en `index_missing`; `answer` responde solo con texto si los embeddings fallan. Verificar antes que el SQLite de `sqlx` traiga FTS5 (si no, `LIKE`)
- [ ] **embed-e5** en el proyecto `ai-proxy`: `multilingual-e5-small` (límite ~768 MB) como modelo base `embed-e5`; alias `candola-embed` → `embed-e5` en el team `candola`; en la app `PROXY_EMBED` → `candola-embed` y prefijos por modelo (e5: `query:`/`passage:`; nomic: `search_query:`/`search_document:`)
- [ ] **Fusión**: reciprocal rank fusion (`Σ 1/(60 + rango)`) de BM25 y coseno → top 8 al LLM; función pura con test. Aplica también en Mac (Ollama + FTS5)

Plan B del modelo: `nomic-embed-text` con Ollama. Gemini por el proxy solo pagado (el tier gratis puede usar los datos).

---------------------------------------------------------------------------------------------------------------
## Números
---------------------------------------------------------------------------------------------------------------

VPS (27-oct): 7,75 GB de RAM (~1,8 GB disponibles), sin swap, 4 vCPU EPYC con AVX2/FMA, 45 GB de disco libres.

Costos de IA con Haiku 5.5 (US$0,10 entrada / US$0,50 salida por millón; estimación de tokens, no medida):
| Uso | Costo |
|---|---|
| Reunión de 1 h (~15k entrada + 1,5k salida) | ≈ US$0,002 |
| Reunión de 3 h | ≈ US$0,008 |
| Orden de chat con herramientas (2–3 llamadas de ~4k) | ≈ US$0,002 |
| Usuario intenso (40 reuniones + 300 órdenes al mes) | ≈ US$0,70/mes |
| Embeddings en el VPS | ~0 |

Plan: **$5.000 CLP/mes IVA incluido** → ≈ $4.200 neto (≈ US$4,4) menos comisión de Transbank (confirmar en el
contrato). El presupuesto de tokens del plan se define con el uso real; sirve de techo contra abuso.

---------------------------------------------------------------------------------------------------------------
## Pendientes que no son código
---------------------------------------------------------------------------------------------------------------

- [ ] Transbank: aprobación de Oneclick Mall y códigos de producción (Diego, en trámite)
- [ ] Resend: cuenta y dominio verificado (cuando haga falta mandar correos)
- [ ] Presupuesto de tokens del plan pagado (con el uso real)
- [ ] Texto de privacidad para testers: qué pasa por el VPS y por cada proveedor
- [ ] AWS: Bedrock bloqueado; créditos (US$140) vencen el 26-abr-2027

---------------------------------------------------------------------------------------------------------------
## Registro de decisiones
---------------------------------------------------------------------------------------------------------------

- 27-oct-2026: backend en Coolify (no Railway), local-first.
- 27-oct-2026: la app nombra la misión, LiteLLM decide modelo y respaldo; prompts en la app.
- 27-oct-2026: corte de una vez a las misiones (pocos testers), sin período de compatibilidad.
- 27-oct-2026: sin vector DB; vectores en SQLite local, `pgvector` si algún día hace falta en el servidor.
- 27-oct-2026: candola-api completa desde el inicio (TS + Hono + Better Auth), no n8n.
- 27-oct-2026: registro por invitación; login y cobro desde ya aunque no haya usuarios pagando.
- 27-oct-2026: Spadelab cobra, $5.000 CLP/mes IVA incluido, Transbank Oneclick Mall.
- 27-oct-2026: GlitchTip para errores; eventos de uso ligados a un UUID opaco (interesa el error, no quién).
- 27-oct-2026: web mínima por ahora; el diseño con Claude Design.
- 27-oct-2026: embeddings híbridos (FTS5 + `multilingual-e5-small` en el VPS + RRF).
- 27-oct-2026: **LiteLLM independiente** (proyecto `ai-proxy`, con su Postgres y el modelo de embeddings) como
  gateway para todos los productos, un team por producto; todo lo propio de la Candola en su proyecto `candola`
  (candola-api, Postgres con `candola` y `glitchtip`, GlitchTip). Reemplaza el Postgres unificado de tres bases.
