# LiteLLM (ai.spadelab.xyz)

Gateway de LLM para La Candola y los productos que vengan. Proyecto `ai-proxy` en Coolify (app `litellm`
`dtae8qoecit4d342rcrij0bi`, BD `litellm-db` `l9vqhnsg1otyz8v58p30w7dy`), imagen `ghcr.io/berriai/litellm:v1.104.5`.
La config vive en la BD (no hay `config.yaml`): se gestiona por la API o el panel.
Actualizar la versión afecta a todos los productos: probar antes.

## Alias del team `candola` (team id `2a730b5f-de4f-45a0-acd5-13aa9e0d6bce`, US$20 / 30 d)

| Alias | Modelo base | Fallback | Notas |
|---|---|---|---|
| `candola-chat` | `claude-haiku` (`anthropic/claude-haiku-5-5`) | `deepseek-flash` | timeout 60 s |
| `candola-reuniones` | `claude-haiku` | `deepseek-flash` | timeout 120 s, `max_tokens` 8192 |
| `candola-gestion` | `claude-haiku` | `deepseek-flash` | timeout 60 s |
| `candola-preguntas` | `claude-haiku` | `deepseek-flash` | timeout 60 s |
| `candola-embed` | — | — | pendiente (Fase 8, `embed-e5`) |

Cada alias es una entrada de modelo propia con los mismos parámetros que el modelo base (incluye
`extra_headers.anthropic-workspace-id` y `additional_drop_params: [temperature]`). Si se cambia el modelo base de
una misión, hay que cambiarlo en su entrada: `PATCH /model/<id>/update`. Los fallbacks están en `router_settings`
(`POST /config/update`); el de `gemini-flash` → `gemini-flash-lite` se conserva.

Modelos base (no los pide ninguna app directo): `claude-haiku`, `claude-sonnet`, `deepseek-flash`,
`gemini-flash`, `gemini-flash-lite`, `nova-2-lite`.

## Acceso

- El team `candola` solo tiene en `models` los 4 alias; las keys del team también. Una key del team que pida
  `candola`, `deepseek-flash` o `claude-haiku` recibe **403** (`key_model_access_denied`).
- Límite: las keys **sin team** y con `models` vacío ven todo. Toda key nueva debe llevar `team_id` y `models`.
  Otro producto = otro team con sus propios alias.
- Sin `Authorization: Bearer …` el dominio responde 404 (router Traefik `https-ai-noauth`).

## Master key y secretos

En el VPS: `/root/litellm/secrets.env` (`LITELLM_MASTER_KEY`, solo root). Keys de testers:
`/root/litellm/keys-testers.txt` (alias → key, solo root). No van al repo ni al chat.
Panel: solo por túnel (`~/SpadeLab/ai-proxy/admin-ui.sh`).

## Crear una key de tester

Desde el VPS (`ssh hetzner-root`), con la master key:

```bash
MASTER=$(grep ^LITELLM_MASTER_KEY /root/litellm/secrets.env | cut -d= -f2-)
curl -s -X POST https://ai.spadelab.xyz/key/generate \
  -H "Authorization: Bearer $MASTER" -H 'Content-Type: application/json' -d '{
    "key_alias": "tester-<nombre>",
    "team_id": "2a730b5f-de4f-45a0-acd5-13aa9e0d6bce",
    "models": ["candola-chat","candola-reuniones","candola-gestion","candola-preguntas"],
    "max_budget": 3, "budget_duration": "30d", "rpm_limit": 30
  }'
```

Guardar la `key` devuelta en `/root/litellm/keys-testers.txt`. Los testers de hoy (`tester-constanza.campos`,
`tester-helen.delafuente`, `tester-alvaro.alarcon`) tienen US$3 / 30 d y 30 rpm.

## Verificar

Con una key del team: un `POST /v1/chat/completions` a cada `candola-*` responde 200; a `candola` o
`deepseek-flash` responde 403. Probado el 27-oct-2026.

## Respaldo

`litellm-db`: respaldo programado de Coolify, 07:30 UTC diario, 14 copias locales en
`/data/coolify/backups/databases/root-team-0/litellm-db-*/` (`pg_dump -Fc`; restaurar con
`pg_restore --no-owner` en una BD temporal). Restauración probada el 27-oct-2026.
La API de Coolify (beta.474) no tiene "ejecutar respaldo ahora": se fuerza con `PATCH` de `frequency` a
`* * * * *` y se devuelve a la real tras ~80 s.
