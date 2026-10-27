import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bearer, eventsBody, hashKey, inviteUsable, newInviteCode, normalizeCode, rateLimited, RATE, sameSecret } from './logic.js'

test('hashKey es SHA-256 hex', () => {
  assert.equal(hashKey('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.ok(sameSecret('x', 'x'))
  assert.ok(!sameSecret('x', 'y'))
})

test('bearer', () => {
  assert.equal(bearer('Bearer sk-1'), 'sk-1')
  assert.equal(bearer('Basic sk-1'), undefined)
  assert.equal(bearer('Bearer '), undefined)
  assert.equal(bearer(undefined), undefined)
})

test('invitaciones', () => {
  const code = newInviteCode()
  assert.match(code, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/)
  assert.equal(normalizeCode(` ${code.toLowerCase()} `), code)
  const now = new Date('2026-10-27T12:00:00Z')
  const later = new Date('2026-11-01T00:00:00Z')
  assert.ok(inviteUsable({ expires_at: later, used_at: null }, now))
  assert.ok(!inviteUsable({ expires_at: later, used_at: now }, now))
  assert.ok(!inviteUsable({ expires_at: now, used_at: null }, now))
  assert.ok(!inviteUsable(undefined, now))
})

test('eventos', () => {
  const ok = { name: 'meeting.done', ts: '2026-10-27T12:00:00-03:00', props: { min: 42 } }
  assert.ok(eventsBody.safeParse({ events: [ok, { name: 'x', ts: '2026-10-27T12:00:00Z' }] }).success)
  assert.ok(!eventsBody.safeParse({ events: [] }).success)
  assert.ok(!eventsBody.safeParse({ events: Array(101).fill(ok) }).success)
  assert.ok(!eventsBody.safeParse({ events: [{ ...ok, name: '' }] }).success)
  assert.ok(!eventsBody.safeParse({ events: [{ ...ok, ts: 'ayer' }] }).success)
  assert.ok(!eventsBody.safeParse({ events: [{ ...ok, props: [1] }] }).success)
})

test('rate limit por ventana', () => {
  const hits = new Map()
  for (let i = 0; i < RATE.limit; i++) assert.ok(!rateLimited(hits, 'k', 0))
  assert.ok(rateLimited(hits, 'k', 1))
  assert.ok(!rateLimited(hits, 'otra', 1))
  assert.ok(!rateLimited(hits, 'k', RATE.windowMs))
})
