# BACKEND ROADMAP

Tracking del backend de la Candola en el VPS. Fuente única: FEATURES.md (F19 "Después", F20, F21) apunta acá.
Marcar `[x]` al terminar cada tarea y anotar la fecha; decisiones nuevas van al registro del final.

Estado al 27-oct-2026 (noche): Fases 0 a 3 hechas en código y mergeadas en `master` (sin versión publicada ni probadas en
la app en vivo). Infra lista: team y alias en LiteLLM, Postgres `candola`, respaldos. candola-api corriendo en Coolify
desde `master` en `https://api.candola.spadelab.xyz`; falta la red interna.

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
| Timer, cámara, distracciones, voz | Usuarios, invitaciones, keys |
| API local `web.rs` y MCP (`mcp/`) | Cobro (Transbank) |
| Índice de reuniones (`meeting_chunks`) | Errores (GlitchTip) y eventos de uso |

**Versión fácil primero.** Hasta que alguien pague: sin login, sin correo, sin código de dispositivo. La invitación
se canjea en la web, la web muestra la key, el usuario la pega en Ajustes (el campo que ya existe). La key es la
identidad en la app, en candola-api y en la web.

---------------------------------------------------------------------------------------------------------------
## Stack
---------------------------------------------------------------------------------------------------------------

Todo en **Coolify**, desplegado siempre por la API de Coolify. No Railway: LiteLLM y su BD ya viven acá, los
embeddings necesitan RAM del VPS y las llamadas entre servicios van por la red interna `coolify` (compartida por
todos los proyectos del servidor), sin exponer keys de administración.

Dos proyectos separados:
- **`ai-proxy` — gateway de LLM, independiente de cualquier producto.** LiteLLM, su Postgres y el modelo de
  embeddings. Sirve a la Candola y a los productos que vengan, cada uno como un *team* de LiteLLM.
- **`candola` — todo lo propio de la Candola.** candola-api y su Postgres. La web va en Vercel.
- **GlitchTip se queda como está**: `docker compose` en `/opt/glitchtip` (Postgres 15 + Redis propios), TLS por el
  Traefik de Coolify, correo por Resend SMTP ya configurado. Migrarlo no da nada; es multiproyecto para otros productos.

```
                                   VPS (Coolify)
                 ┌───────────────────────────────────────────────────┐
                 │ proyecto ai-proxy (compartido)                     │
App Candola ─────┼──▶ LiteLLM ── Anthropic / DeepSeek / …             │
(Mac/Win)        │      │  teams: candola · <otros productos>         │
  IA: key del    │      ├── embed-e5 (multilingual-e5-small)          │
  team candola   │      └── Postgres (litellm)                        │
                 └──────▲────────────────────────────────────────────┘
                        │ red interna coolify (master key, solo en candola-api)
                 ┌──────┴────────────────────────────────────────────┐
  Vercel         │ proyecto candola                                   │
  site/ ── POST ─┼──▶ candola-api (invitaciones, keys, /v1/me,        │
App: /v1/me, ────┼──▶   /v1/events, Transbank)                        │
  eventos        │    Postgres 16 (candola)                           │
                 └───────────────────────────────────────────────────┘
                 /opt/glitchtip ◀── errores de la app (opt-in), fuera de Coolify
```

| Proyecto | Pieza | Qué | Estado |
|---|---|---|---|
| ai-proxy | LiteLLM | Gateway de LLM: modelos base, alias por producto, fallbacks, teams, keys, presupuestos. Config en su BD (no hay `config.yaml` montado) | ✅ En producción (v1.104.5, 612 MB), sin teams ni misiones |
| ai-proxy | Postgres 16 (`litellm-db`) | Base de LiteLLM, gestionada por Coolify | ✅ Existe. Respaldo programado pendiente |
| ai-proxy | embed-e5 | `multilingual-e5-small` (384 dim) con text-embeddings-inference o Ollama; modelo base `embed-e5` | ❌ |
| candola | candola-api | TypeScript + Hono (Node 22), `postgres` (postgres.js), migraciones SQL numeradas, zod. Carpeta `server/` del repo, Dockerfile | ❌ |
| candola | Postgres 16 | Base `candola`, gestionada por Coolify (respaldo programado). Sin vector DB: si algún día el servidor busca, `pgvector` acá | ❌ |
| — | GlitchTip | `/opt/glitchtip`, `glitchtip.spadelab.xyz`. 1 proyecto, 3 eventos | ✅ En producción, ~430 MB |
| Vercel | Web | `site/`, autodeploy por GitHub. Mínima; el diseño después con Claude Design | ❌ |
| — | Correo | Resend: la cuenta ya existe (la usa GlitchTip). candola-api no manda correo por ahora | ✅ Cuenta |

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

- **Acceso de candola-api a LiteLLM**: master key, solo en candola-api (variable en Coolify, red interna, nunca en
  la web ni en la app). candola-api únicamente toca keys de su team. Deuda: key de gestión por team cuando LiteLLM
  la dé sin enterprise. No gastar tiempo verificándolo ahora.
- **La config de LiteLLM vive en su BD** (alias, fallbacks, teams, keys): el respaldo de `litellm-db` la cubre.
  Para que sea legible sin entrar al panel: `infra/litellm/README.md` en el repo con la tabla alias → modelo base →
  fallback, actualizada en cada cambio.
- **Actualizar LiteLLM afecta a todos los productos**: versión fijada y probar antes de subirla.

---------------------------------------------------------------------------------------------------------------
## Fases
---------------------------------------------------------------------------------------------------------------

Orden por valor para los testers de hoy: primero lo que anda roto (preguntas a reuniones), después el corte a
misiones, después ver errores. Cuenta y cobro al final, en versión fácil.

### Fase 0 — FTS5 en la app (no necesita el VPS)
Urgente: desde el 27-oct `titan-embed-v2` responde "Error 002" y preguntarle a las reuniones no anda en Windows.
- [x] Tabla virtual FTS5 sobre el texto de `meeting_chunks`, llenada en `index_missing`. Verificar antes que el SQLite de `sqlx` traiga FTS5 (si no, `LIKE`)
- [x] `answer` responde solo con texto si los embeddings fallan
- [x] Tests de `embed` en `ai.rs` que usan `titan-embed-v2`: quitar o apuntar a `candola-embed` (hoy fallan)

Hecho cuando: en Windows, preguntarle a las reuniones responde aunque no haya embeddings.

### Fase 1 — Infra base
- [x] 2 GB de swap en el VPS (`/swapfile`, `swappiness=10`) — 27-oct-2026
- [x] `ai-proxy`: respaldo programado de `litellm-db` (07:30 UTC, 14 copias locales, restauración probada — 27-oct-2026) desde Coolify (es BD gestionada) y probar una restauración
- [x] `ai-proxy`: team `candola` en LiteLLM (US$20/30 d) — 27-oct-2026
- [x] Proyecto `candola` en Coolify con Postgres 16 `candola-db` (base `candola`), respaldo 08:00 UTC y restauración probada — 27-oct-2026

Hecho cuando: los dos proyectos aparecen en Coolify con respaldos probados.

### Fase 2 — Misiones (corte total)
Nadie usa las keys de testers todavía: se mata lo viejo y se parte limpio, sin compatibilidad.
- [x] LiteLLM: modelos base con nombres genéricos (los de hoy ya lo son: `claude-haiku`, `deepseek-flash`)
- [x] LiteLLM: los 4 alias `candola-*` (`candola-embed` en la Fase 7) apuntando a los modelos base, permitidos solo al team `candola`
- [x] LiteLLM: `fallbacks` en el router (`candola-*` → `deepseek-flash`)
- [x] LiteLLM: borrados el alias `candola`, los `bench-*` y `titan-embed-v2`; keys nuevas en el team con solo las misiones — 27-oct-2026. Las 3 keys viejas quedan bloqueadas (borrarlas lo bloqueó el modo automático)
- [x] `infra/litellm/README.md` con la tabla alias → base → fallback
- [x] App (`ai.rs`): pedir solo misiones; fuera `BACKUP`, `for_meeting` y el reintento de `ai_chat`; tests
- [ ] Publicar versión (tag → CI de Windows) y repartir las keys nuevas
- [x] Verificar con una key de tester: los 4 alias responden 200 (27-oct-2026); falta probar las 4 funciones en la app

Hecho cuando: en LiteLLM no queda nada que no sea modelo base, team `candola` y sus alias; las 4 funciones andan.

### Fase 3 — Errores a GlitchTip (no necesita candola-api)
- [x] Sentry SDK en Rust (panic hook) y JS (`onerror`, `unhandledrejection`) → GlitchTip, proyecto `candola`
- [x] `release` = versión, `environment` = SO, `user.id` = UUID local; `beforeSend` limpia rutas y textos
- [x] Opt-in: interruptor en Ajustes (el aviso al registrarse va con la web); apagado = ni una petición
- [ ] Fallos de IA, reuniones y cámara como errores

Hecho cuando: un crash provocado en una build de prueba aparece en GlitchTip con versión, SO y UUID, sin datos personales.

### Fase 4 — candola-api mínima
Sin Better Auth, sin correo, sin código de dispositivo. La key de LiteLLM es la identidad.
- [x] Esqueleto `server/`: Hono, postgres.js, migraciones, zod, Dockerfile, `/health`
- [x] Despliegue por la API de Coolify en el proyecto `candola`: app `wo5p37tmn3yapqp2nwejt08n` desde `master`, `https://api.candola.spadelab.xyz` (registro A gris) — 27-oct-2026
- [ ] Llega a LiteLLM por la red interna `coolify` con la master key — hoy por `https://ai.spadelab.xyz`; falta `custom_network_aliases: litellm` en LiteLLM (reinicia el servicio) y `LITELLM_URL=http://litellm:4000`
- [x] Tablas: `users` (UUID opaco, plan, key_hash, creado), `invites` (código de un uso, vencimiento, usado_por)
- [x] `POST /admin/invites` (token de admin en Coolify)
- [x] `POST /v1/invites/redeem` → usuario + key en el team `candola` (`/key/generate`, solo misiones, presupuesto gratis, `metadata.user_id`); devuelve la key una sola vez
- [x] `GET /v1/me` (Bearer = key): id, plan, presupuesto usado/restante, estado de pago, avisos
- [x] `POST /v1/events` (Bearer = key, mismo usuario): lote, rate limit por key, tope de tamaño, borrado a los 90 días
- [x] Tests de la lógica pura (invitaciones, validación de eventos)
- [ ] App: eventos de uso → `/v1/events` (cola local con reintento, envío en lote, bajo el mismo opt-in de la fase 3)

Hecho cuando: con una invitación se obtiene una key que funciona contra LiteLLM, `/v1/me` la reconoce y los eventos llegan.

### Fase 5 — Web mínima (Vercel)
- [ ] `site/` enlazado a GitHub (push a `master` → producción)
- [ ] Descarga: última release de GitHub (Mac `.dmg`, Windows `.exe`), aviso de Gatekeeper/SmartScreen
- [ ] Canje de invitación: muestra la key una vez y cómo pegarla en Ajustes (llama a candola-api; CORS solo del dominio y previews)

Hecho cuando: un invitado canjea, descarga, pega la key y la IA anda.

### Fase 6 — Cobro (Transbank Oneclick Mall), cuando Transbank apruebe
Webpay Plus no hace cobros recurrentes: se usa Oneclick Mall (inscribir tarjeta + cobro mensual propio).
La web identifica al usuario con su key (la pega en la página de pago) hasta que exista login.
- [ ] Integración con `transbank-sdk` y códigos de prueba
- [ ] Inscripción de tarjeta (inicio → retorno → guardar `tbk_user`)
- [ ] Cron mensual dentro de candola-api: cobra $5.000 CLP; OK → `/key/update` renueva el presupuesto del plan; falla → tope gratis
- [ ] Reintento de cobro fallido y aviso en `/v1/me`
- [ ] Baja de suscripción (borrar inscripción)
- [ ] App: `account_get` → `/v1/me` y panel con plan, presupuesto y estado de pago
- [ ] Producción: variables en Coolify `TBK_COMMERCE_CODE`, `TBK_CHILD_COMMERCE_CODE`, `TBK_API_KEY` (los pone Diego cuando Transbank apruebe)

Hecho cuando: en integración, una tarjeta de prueba se inscribe, se cobra y la key cambia de presupuesto.

### Fase 7 — Embeddings en el VPS (búsqueda híbrida)
- [ ] **embed-e5** en el proyecto `ai-proxy`: `multilingual-e5-small` (límite ~768 MB) como modelo base `embed-e5`; alias `candola-embed` → `embed-e5` en el team `candola`; en la app `PROXY_EMBED` → `candola-embed` y prefijos por modelo (e5: `query:`/`passage:`; nomic: `search_query:`/`search_document:`)
- [ ] **Fusión**: reciprocal rank fusion (`Σ 1/(60 + rango)`) de BM25 (FTS5 de la fase 0) y coseno → top 8 al LLM; función pura con test. Aplica también en Mac (Ollama + FTS5)

Plan B del modelo: `nomic-embed-text` con Ollama. Plan C, local-first: calcular `e5-small` en la app con ONNX
(cero RAM en el VPS; cuesta meter `ort` en el build de Windows). Gemini por el proxy solo pagado (el tier gratis
puede usar los datos).

### Después, si hace falta (no planificado)
Login con correo (Better Auth + Resend), código de dispositivo para no pegar la key, quitar el campo de la key,
key de gestión por team en LiteLLM. Solo cuando haya usuarios pagando que lo pidan.

---------------------------------------------------------------------------------------------------------------
## Misiones de desarrollo (delegación)
---------------------------------------------------------------------------------------------------------------

Cada misión es una sesión aparte en su worktree. Agente según dificultad: Sonnet para cambios acotados con tests,
Opus para piezas nuevas de varios archivos. Dos misiones nunca escriben el mismo archivo a la vez.

| # | Misión | Fase | Archivos / lugar | Agente | Estado |
|---|---|---|---|---|---|
| M1 | FTS5 en la app, `answer` solo texto si no hay embeddings | 0 | `meeting.rs`, `db.rs` | Sonnet | hecha, en master 27-oct |
| M2 | Infra: swap, respaldos, team `candola`, alias y fallbacks, borrar lo viejo, Postgres `candola` | 1 + 2 (LiteLLM) | VPS por API de Coolify y LiteLLM, `infra/litellm/README.md` | Sonnet | hecha salvo borrar 3 keys viejas y alias de red; en master 27-oct |
| M3 | App pide solo misiones (fuera `BACKUP`, `for_meeting`, reintento) | 2 (app) | `ai.rs`, llamada en `meeting.rs`, tests de `embed` | Sonnet | hecha, en master 27-oct |
| M4 | Errores a GlitchTip con opt-in | 3 | panic hook en Rust, `onerror` en JS, interruptor en Ajustes | Opus | hecha, en master 27-oct |
| M5 | candola-api mínima y despliegue | 4 | `server/` | Opus | hecha; falta red interna (Diego); en master 27-oct |
| M6 | Web mínima: descarga y canje de invitación | 5 | `site/` | Sonnet | espera el contrato de M5 |
| M7 | Cobro Transbank | 6 | `server/`, `site/` | Opus | bloqueada por Transbank |
| M8 | embed-e5 en el VPS y fusión RRF | 7 | `ai-proxy`, `meeting.rs` | Sonnet | después de M1 y M2 |

---------------------------------------------------------------------------------------------------------------
## Números
---------------------------------------------------------------------------------------------------------------

VPS (27-oct, medido con `docker stats`): 7,75 GB de RAM, 5,9 GB usados, 1,87 GB disponibles, sin swap, 4 vCPU
EPYC con AVX2/FMA, 45 GB de disco libres. 46 contenedores; lo nuestro: LiteLLM 612 MB, GlitchTip ~430 MB (web,
worker, Postgres, Redis), Coolify ~660 MB. El resto son otros proyectos. Lo que se suma: Postgres 16 (~40 MB en
reposo), candola-api (~100 MB), embed-e5 (400–800 MB). Cabe con el swap de la fase 1; si aprieta, primero revisar
los otros proyectos, no la Candola.

Costos de IA con Haiku 5.5 (US$0,10 entrada / US$0,50 salida por millón hasta 100k tokens por petición;
estimación de tokens, no medida):
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
- [ ] Presupuesto de tokens del plan pagado (con el uso real)
- [ ] Texto de privacidad para testers: qué pasa por el VPS y por cada proveedor
- [ ] AWS: Bedrock bloqueado; créditos (US$140) vencen el 26-abr-2027

---------------------------------------------------------------------------------------------------------------
## Registro de decisiones
---------------------------------------------------------------------------------------------------------------

- 27-oct-2026: backend en Coolify (no Railway), local-first.
- 27-oct-2026: la app nombra la misión, LiteLLM decide modelo y respaldo; prompts en la app.
- 27-oct-2026: sin vector DB; vectores en SQLite local, `pgvector` si algún día hace falta en el servidor.
- 27-oct-2026: candola-api en TS + Hono, no n8n.
- 27-oct-2026: registro por invitación; cobro desde ya aunque no haya usuarios pagando.
- 27-oct-2026: Spadelab cobra, $5.000 CLP/mes IVA incluido, Transbank Oneclick Mall.
- 27-oct-2026: GlitchTip para errores; eventos de uso ligados a un UUID opaco (interesa el error, no quién).
- 27-oct-2026: web mínima por ahora; el diseño con Claude Design.
- 27-oct-2026: embeddings híbridos (FTS5 + `multilingual-e5-small` en el VPS + RRF).
- 27-oct-2026: **LiteLLM independiente** (proyecto `ai-proxy`, con su Postgres y el modelo de embeddings) como
  gateway para todos los productos, un team por producto; lo propio de la Candola en su proyecto `candola`.
- 27-oct-2026 (revisión): **FTS5 primero**, es lo único roto hoy y no necesita el VPS.
- 27-oct-2026 (revisión): **corte total a misiones**: nadie usa las keys de testers, se borran alias y keys viejas
  el mismo día, sin compatibilidad.
- 27-oct-2026 (revisión): **versión fácil de cuenta**: sin Better Auth, sin correo, sin código de dispositivo. La
  invitación se canjea en la web, la web muestra la key, el usuario la pega en Ajustes. La key es la identidad en
  app, candola-api y web (también para pagar). Login y device code solo si alguien pagando lo pide.
- 27-oct-2026 (revisión): **GlitchTip se queda en `/opt/glitchtip`** (ya tiene TLS por Traefik y Resend). No se
  migra a Coolify; el Postgres de `candola` no lleva la base `glitchtip`.
- 27-oct-2026 (revisión): errores a GlitchTip antes que candola-api (no depende del backend); eventos de uso
  después, con `/v1/events` autenticado con la misma key.
- 27-oct-2026 (revisión): candola-api usa la master key de LiteLLM (solo ahí, red interna); la key de gestión por
  team queda como deuda.
- 27-oct-2026 (revisión): respaldos con los programados de Coolify (las dos BD son gestionadas); la config de
  LiteLLM vive en su BD y se documenta en `infra/litellm/README.md`.
