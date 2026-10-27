# candola-api

Backend propio de la Candola: invitaciones, usuarios, keys de LiteLLM, `/v1/me` y eventos de uso.
TypeScript + Hono sobre Node 22, `postgres` (postgres.js), zod. Las migraciones de `migrations/` se aplican solas al
arrancar (tabla `migrations`).

Producción: `https://api.candola.spadelab.xyz` (Coolify, proyecto `candola`).

## Identidad

La key de LiteLLM **es** la identidad del usuario: la app, esta API y la web mandan `Authorization: Bearer <key>`.
La API solo guarda el SHA-256 de la key (`users.key_hash`); la key se muestra una sola vez, al canjear la invitación.
No hay correo, contraseña ni sesión.

## Endpoints

Todas las respuestas son JSON. Errores: `{"error": "<código>"}`.

| Código | HTTP | Cuándo |
|---|---|---|
| `invalid_request` | 400 | JSON inválido o no cumple el esquema |
| `invalid_invite` | 400 | Código inexistente, ya usado o vencido (no se distingue cuál) |
| `unauthorized` | 401 | Falta el Bearer o no corresponde a ningún usuario (no se distingue cuál) |
| `too_large` | 413 | Cuerpo de `/v1/events` sobre 64 KB |
| `rate_limited` | 429 | Más de 30 `POST /v1/events` por minuto con la misma key |
| `internal` | 500 | Error del servidor o de LiteLLM |

### `GET /health`
`200 {"ok": true}`

### `POST /admin/invites`
Header `Authorization: Bearer <ADMIN_TOKEN>`. Cuerpo opcional `{"days": 7}` (1–365, por defecto 7).

`201 {"code": "PEBC-ATFF-RCSZ", "expires_at": "2026-11-03T22:24:42.308Z"}`

Códigos de 12 caracteres sin `0 O 1 I L`; al canjear se ignoran mayúsculas y espacios.

### `POST /v1/invites/redeem`
Sin auth. Cuerpo `{"code": "pebc-atff-rcsz"}`.

`201 {"user_id": "<uuid>", "plan": "free", "key": "sk-..."}`

Marca la invitación como usada, crea el usuario y genera su key en LiteLLM (team `candola`, modelos
`candola-chat`, `candola-reuniones`, `candola-gestion`, `candola-preguntas`, `max_budget` = `FREE_BUDGET_USD` renovable cada 30 días,
`metadata.user_id`). **La key no se vuelve a mostrar**: la web debe pedir que el usuario la copie o pasarla a la app.

### `GET /v1/me`
Header `Authorization: Bearer <key>`.

```json
{
  "id": "84a2e2ce-1c81-4f4d-a41c-8bac6a79edc5",
  "plan": "free",
  "budget": { "used_usd": 0.012, "max_usd": 1, "remaining_usd": 0.988 },
  "payment_status": "none",
  "notices": []
}
```

`max_usd` y `remaining_usd` son `null` si la key no tiene tope. `payment_status` por ahora siempre es `none`;
`notices` es una lista (vacía por ahora) para avisos que la app muestre.

### `POST /v1/events`
Header `Authorization: Bearer <key>`. Cuerpo hasta 64 KB:

```json
{ "events": [ { "name": "meeting.done", "ts": "2026-10-27T12:00:00-03:00", "props": { "min": 42 } } ] }
```

- 1 a 100 eventos por lote.
- `name`: 1–100 caracteres. `ts`: ISO 8601 con zona (`Z` u offset). `props`: objeto opcional.

`202 {"accepted": 2}`. Los eventos se borran a los 90 días de recibidos (job al arrancar y cada 24 h).

## Variables de entorno

| Variable | Qué |
|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/candola` |
| `LITELLM_URL` | LiteLLM por la red interna `coolify`, p. ej. `http://<contenedor-litellm>:4000` |
| `LITELLM_MASTER_KEY` | Para `/key/generate` y `/key/delete` (solo vive acá, en Coolify) |
| `LITELLM_TEAM_ID` | `team_id` del team `candola` |
| `ADMIN_TOKEN` | Bearer de `/admin/*` |
| `FREE_BUDGET_USD` | `max_budget` de las keys del plan gratis (cada 30 días) |
| `PORT` | Puerto HTTP (por defecto 3000) |

## Desarrollo

```bash
npm install
npm test          # tsc + node:test sobre la lógica pura
npm run build
docker run -d --rm --name candola-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=candola -p 55432:5432 postgres:16-alpine
DATABASE_URL=postgres://postgres:pw@127.0.0.1:55432/candola LITELLM_URL=http://127.0.0.1:4000 \
  LITELLM_MASTER_KEY=... LITELLM_TEAM_ID=... ADMIN_TOKEN=dev FREE_BUDGET_USD=1 npm start
```

Migración nueva: agregar `migrations/NNN_algo.sql` (orden alfabético, nunca editar una ya aplicada).
