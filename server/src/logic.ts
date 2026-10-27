// Lógica pura (sin BD ni red), cubierta por logic.test.ts.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex')

// Compara sin filtrar por tiempo cuánto del secreto coincide.
export const sameSecret = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(hashKey(a), 'hex'), Buffer.from(hashKey(b), 'hex'))

export const bearer = (header: string | undefined) => header?.match(/^Bearer (\S+)$/)?.[1]

// Sin 0/O/1/I/L para que se pueda dictar.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const newInviteCode = () => {
  const chars = [...randomBytes(12)].map((b) => ALPHABET[b % ALPHABET.length])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`
}

export const normalizeCode = (code: string) => code.trim().toUpperCase()

type Invite = { expires_at: Date; used_at: Date | null }
export const inviteUsable = (invite: Invite | undefined, now: Date) =>
  !!invite && invite.used_at === null && invite.expires_at > now

export const createInviteBody = z.object({ days: z.number().int().min(1).max(365).default(7) })
export const redeemBody = z.object({ code: z.string().min(1).max(64) })

export const eventsBody = z.object({
  events: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        ts: z.iso.datetime({ offset: true }),
        props: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(100),
})

// ponytail: ventana fija en memoria, se pierde al reiniciar y no se comparte entre réplicas; Redis/Postgres si hay más de una.
export const RATE = { limit: 30, windowMs: 60_000 }
export const rateLimited = (hits: Map<string, { start: number; count: number }>, key: string, now: number) => {
  const h = hits.get(key)
  if (!h || now - h.start >= RATE.windowMs) {
    hits.set(key, { start: now, count: 1 })
    return false
  }
  return ++h.count > RATE.limit
}
