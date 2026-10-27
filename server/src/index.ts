import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { serve } from '@hono/node-server'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { logger } from 'hono/logger'
import postgres from 'postgres'
import {
  bearer, createInviteBody, eventsBody, hashKey, inviteUsable, newInviteCode, normalizeCode, rateLimited,
  redeemBody, sameSecret,
} from './logic.js'

const env = (name: string) => {
  const v = process.env[name]
  if (!v) throw new Error(`Falta la variable de entorno ${name}`)
  return v
}
const LITELLM_URL = env('LITELLM_URL').replace(/\/$/, '')
const MASTER_KEY = env('LITELLM_MASTER_KEY')
const TEAM_ID = env('LITELLM_TEAM_ID')
const ADMIN_TOKEN = env('ADMIN_TOKEN')
const FREE_BUDGET_USD = Number(env('FREE_BUDGET_USD'))
const MODELS = ['candola-chat', 'candola-reuniones', 'candola-gestion', 'candola-preguntas']

const sql = postgres(env('DATABASE_URL'), { onnotice: () => {} })

async function migrate() {
  await sql`create table if not exists migrations (name text primary key, applied_at timestamptz not null default now())`
  const dir = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    const [done] = await sql`select 1 from migrations where name = ${name}`
    if (done) continue
    const text = await readFile(new URL(name, dir), 'utf8')
    await sql.begin(async (tx) => {
      await tx.unsafe(text)
      await tx`insert into migrations (name) values (${name})`
    })
    console.log('migración aplicada:', name)
  }
}

async function litellm(path: string, auth: string, body?: unknown) {
  const res = await fetch(LITELLM_URL + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`LiteLLM ${path}: ${res.status} ${await res.text()}`)
  return res.json() as Promise<any>
}

const json = (c: Context) => c.req.json().catch(() => undefined)
const invalid = (c: Context) => c.json({ error: 'invalid_request' }, 400)
const unauthorized = (c: Context) => c.json({ error: 'unauthorized' }, 401)

type User = { id: string; plan: string }
const app = new Hono<{ Variables: { user: User; key: string } }>()
app.use(logger())
app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'internal' }, 500)
})

app.get('/health', (c) => c.json({ ok: true }))

app.post('/admin/invites', async (c) => {
  if (!sameSecret(bearer(c.req.header('Authorization')) ?? '', ADMIN_TOKEN)) return unauthorized(c)
  const p = createInviteBody.safeParse((await json(c)) ?? {})
  if (!p.success) return invalid(c)
  const code = newInviteCode()
  const [row] = await sql`
    insert into invites (code, expires_at) values (${code}, now() + make_interval(days => ${p.data.days}))
    returning code, expires_at`
  return c.json(row, 201)
})

app.post('/v1/invites/redeem', async (c) => {
  const p = redeemBody.safeParse(await json(c))
  if (!p.success) return invalid(c)
  const code = normalizeCode(p.data.code)
  const created = await sql.begin(async (tx) => {
    const [invite] = await tx<{ expires_at: Date; used_at: Date | null }[]>`
      select expires_at, used_at from invites where code = ${code} for update`
    if (!inviteUsable(invite, new Date())) return null
    const id = randomUUID()
    const { key } = await litellm('/key/generate', MASTER_KEY, {
      team_id: TEAM_ID,
      models: MODELS,
      max_budget: FREE_BUDGET_USD,
      budget_duration: '30d', // como las keys de testers: el tope gratis se renueva cada mes
      key_alias: `candola-${id}`,
      metadata: { user_id: id },
    })
    try {
      await tx`insert into users (id, plan, key_hash) values (${id}, 'free', ${hashKey(key)})`
      await tx`update invites set used_by = ${id}, used_at = now() where code = ${code}`
    } catch (err) {
      // Que no quede una key viva sin usuario.
      await litellm('/key/delete', MASTER_KEY, { keys: [key] }).catch(console.error)
      throw err
    }
    return { id, key: key as string }
  })
  if (!created) return c.json({ error: 'invalid_invite' }, 400)
  return c.json({ user_id: created.id, plan: 'free', key: created.key }, 201)
})

app.use('/v1/*', async (c, next) => {
  if (c.req.path === '/v1/invites/redeem') return next()
  const key = bearer(c.req.header('Authorization'))
  if (!key) return unauthorized(c)
  const [user] = await sql<User[]>`select id, plan from users where key_hash = ${hashKey(key)}`
  if (!user) return unauthorized(c)
  c.set('user', user)
  c.set('key', key)
  await next()
})

app.get('/v1/me', async (c) => {
  const user = c.get('user')
  // Con la propia key: LiteLLM devuelve solo la info de esa key.
  const { info } = await litellm('/key/info', c.get('key'))
  const used: number = info.spend ?? 0
  const max: number | null = info.max_budget ?? null
  return c.json({
    id: user.id,
    plan: user.plan,
    budget: { used_usd: used, max_usd: max, remaining_usd: max === null ? null : Math.max(0, max - used) },
    payment_status: 'none',
    notices: [],
  })
})

const hits = new Map<string, { start: number; count: number }>()
app.post(
  '/v1/events',
  async (c, next) => {
    if (rateLimited(hits, c.get('user').id, Date.now())) return c.json({ error: 'rate_limited' }, 429)
    await next()
  },
  bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'too_large' }, 413) }),
  async (c) => {
    const p = eventsBody.safeParse(await json(c))
    if (!p.success) return invalid(c)
    const userId = c.get('user').id
    const rows = p.data.events.map((e) => ({
      user_id: userId,
      name: e.name,
      ts: e.ts,
      props: e.props ? sql.json(e.props as postgres.JSONValue) : null,
    }))
    await sql`insert into events ${sql(rows, 'user_id', 'name', 'ts', 'props')}`
    return c.json({ accepted: rows.length }, 202)
  },
)

const purgeEvents = () =>
  sql`delete from events where received_at < now() - interval '90 days'`
    .then((r) => r.count && console.log('eventos borrados:', r.count))
    .catch(console.error)

await migrate()
purgeEvents()
setInterval(purgeEvents, 24 * 60 * 60 * 1000)
// ponytail: limpia el rate limit de keys inactivas; sin esto el Map crece con cada usuario.
setInterval(() => hits.clear(), 60 * 60 * 1000)

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () => console.log(`candola-api en :${port}`))
