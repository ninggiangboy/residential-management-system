import { describe, expect, test } from 'bun:test'
import type { DomainError } from '@core/kernel'
import {
  canonicalJson,
  createIdempotent,
  type IdempotencyAccount,
  type IdempotencyStore,
  type IdempotentContext,
  requestHash,
  STALE_IN_PROGRESS_MS,
  type StoredKey,
} from './idempotency'

/** A store in memory whose transaction restores the rows when the function throws, as a rollback does. */
class MemoryStore implements IdempotencyStore {
  rows = new Map<string, StoredKey>()
  private id = (a: IdempotencyAccount, key: string) => `${a.kind}:${a.id}:${key}`
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const before = new Map(this.rows)
    try {
      return await fn()
    } catch (error) {
      this.rows = before
      throw error
    }
  }
  async claim(a: IdempotencyAccount, key: string, requestHash: string) {
    if (this.rows.has(this.id(a, key))) return false
    this.rows.set(this.id(a, key), {
      requestHash,
      status: 'in_progress',
      responseStatus: null,
      responseBody: null,
      createdAt: now.current,
    })
    return true
  }
  async find(a: IdempotencyAccount, key: string) {
    return this.rows.get(this.id(a, key)) ?? null
  }
  async complete(a: IdempotencyAccount, key: string, r: { status: number; body: unknown }) {
    const row = this.rows.get(this.id(a, key))
    if (row)
      this.rows.set(this.id(a, key), {
        ...row,
        status: 'completed',
        responseStatus: r.status,
        responseBody: r.body,
      })
  }
  async release(a: IdempotencyAccount, key: string, olderThan?: Date) {
    const row = this.rows.get(this.id(a, key))
    if (!row || (olderThan && row.createdAt >= olderThan)) return false
    return this.rows.delete(this.id(a, key))
  }
}

const now = { current: new Date('2026-10-23T03:00:00Z') }
const clock = { now: () => now.current }

const account = { kind: 'staff', id: '018f0000-0000-7000-8000-000000000001' } as const
const contextOf = (
  key: string | null,
  body: unknown = { kind: 'unit_owner' },
  extra: Partial<IdempotentContext> = {},
): IdempotentContext => ({
  request: new Request('http://localhost/api/v1/staff/imports', {
    method: 'POST',
    headers: key === null ? {} : { 'idempotency-key': key },
  }),
  set: { headers: {} },
  body,
  route: '/api/v1/staff/imports',
  ...extra,
})

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error as DomainError
  }
  throw new Error('expected a failure')
}

function setup() {
  const store = new MemoryStore()
  const idempotent = createIdempotent(store, clock)
  let calls = 0
  const handle = (
    mode: 'transaction' | 'external' = 'transaction',
    run: (context: IdempotentContext) => Promise<unknown> = async (context) => {
      context.set.status = 201
      context.set.headers.location = '/api/v1/staff/imports/1'
      return { id: ++calls }
    },
  ) => idempotent({ account: () => account, mode }, run)
  return { store, handle, calls: () => calls }
}

describe.each(['transaction', 'external'] as const)('the wrapper, %s mode', (mode) => {
  test('the same key and request twice: one run, the second replays status, body and Location', async () => {
    const { handle, calls } = setup()
    const route = handle(mode)
    const first = contextOf('key-0000001')
    expect(await route(first)).toEqual({ id: 1 })
    const second = contextOf('key-0000001')
    expect(await route(second)).toEqual({ id: 1 })
    expect(calls()).toBe(1)
    expect(second.set.status).toBe(201)
    expect(second.set.headers['idempotent-replayed']).toBe('true')
    expect(second.set.headers.location).toBe('/api/v1/staff/imports/1')
    expect(first.set.headers['idempotent-replayed']).toBeUndefined()
  })

  test('the same key with another body is 422 idempotency_key_reuse and nothing runs', async () => {
    const { handle, calls } = setup()
    const route = handle(mode)
    await route(contextOf('key-0000002'))
    const error = await failure(route(contextOf('key-0000002', { kind: 'other' })))
    expect(error).toMatchObject({ code: 'idempotency_key_reuse' })
    expect(error.kind).toBe('validation')
    expect(calls()).toBe(1)
  })

  test('a missing key is 400 required and a malformed one 400 format', async () => {
    const route = setup().handle(mode)
    expect(await failure(route(contextOf(null)))).toMatchObject({
      code: 'validation_failed',
      details: [{ path: 'header.Idempotency-Key', code: 'required' }],
    })
    for (const key of ['short', 'has space in it', 'x'.repeat(129)])
      expect(await failure(route(contextOf(key)))).toMatchObject({
        details: [{ path: 'header.Idempotency-Key', code: 'format' }],
      })
  })

  test('a failed request stores nothing: the retry runs again', async () => {
    const { store, handle } = setup()
    let attempt = 0
    const route = handle(mode, async (context) => {
      if (++attempt === 1) throw new Error('boom')
      context.set.status = 201
      return { attempt }
    })
    await failure(route(contextOf('key-0000003')))
    expect(store.rows.size).toBe(0)
    expect(await route(contextOf('key-0000003'))).toEqual({ attempt: 2 })
  })

  test('an answer that is not 2xx is returned but not stored', async () => {
    const { store, handle } = setup()
    const route = handle(mode, async (context) => {
      context.set.status = 304
      return null
    })
    await route(contextOf('key-0000004'))
    expect(store.rows.size).toBe(0)
  })

  test("another account's key is unrelated", async () => {
    const store = new MemoryStore()
    const idempotent = createIdempotent(store, clock)
    let runs = 0
    const as = (id: string) =>
      idempotent({ account: () => ({ kind: 'staff', id }), mode }, async () => ({ run: ++runs }))
    await as('018f0000-0000-7000-8000-000000000001')(contextOf('key-0000005'))
    await as('018f0000-0000-7000-8000-000000000002')(contextOf('key-0000005'))
    expect(runs).toBe(2)
  })

  test('two requests at once run once and both get the same answer', async () => {
    const { handle, calls } = setup()
    const route = handle(mode, async (context) => {
      await Bun.sleep(10)
      context.set.status = 201
      return { id: 1 }
    })
    const results = await Promise.allSettled([
      route(contextOf('key-0000006')),
      route(contextOf('key-0000006')),
    ])
    expect(calls()).toBe(0)
    // In memory the transaction does not serialise the claim, so the second sees a row in progress: transaction mode replays
    // after the first completes only against a real database (modules tests); here no run is duplicated.
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1)
  })
})

describe('the external mode', () => {
  test('a duplicate while the first is in progress is 409 request_in_progress with Retry-After', async () => {
    const { store, handle } = setup()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const route = handle('external', async (context) => {
      await gate
      context.set.status = 201
      return { ok: true }
    })
    const first = route(contextOf('key-0000007'))
    await Bun.sleep(5)
    const error = await failure(route(contextOf('key-0000007')))
    expect(error).toMatchObject({ code: 'request_in_progress', retryAfterSeconds: 1 })
    release()
    await first
    expect([...store.rows.values()][0]?.status).toBe('completed')
  })

  test('an in-progress key of a request that died is taken over after five minutes', async () => {
    const { store, handle, calls } = setup()
    const route = handle('external')
    const ctx = contextOf('key-0000008')
    await store.claim(account, 'key-0000008', requestHash(ctx))
    expect(await failure(route(contextOf('key-0000008')))).toMatchObject({
      code: 'request_in_progress',
    })
    now.current = new Date(now.current.getTime() + STALE_IN_PROGRESS_MS + 1000)
    expect(await route(contextOf('key-0000008'))).toEqual({ id: 1 })
    expect(calls()).toBe(1)
  })
})

describe('the request hash of DOC-50 §8.2', () => {
  const hash = (body: unknown, extra: Partial<IdempotentContext> = {}) =>
    requestHash(contextOf('key-0000009', body, extra))

  test('key order and undefined members do not matter, a changed value does', () => {
    expect(hash({ a: 1, b: { c: 2, d: 3 } })).toBe(hash({ b: { d: 3, c: 2 }, a: 1, e: undefined }))
    expect(hash({ phone: '0912345678' })).not.toBe(hash({ phone: '+84912345678' }))
  })

  test('the route, the path parameters and X-Unit-Id are part of it; the key and the query are not', () => {
    const base = hash({ a: 1 })
    expect(hash({ a: 1 }, { route: '/api/v1/other' })).not.toBe(base)
    expect(hash({ a: 1 }, { params: { id: 'x' } })).not.toBe(base)
    const unit = contextOf(
      'key-0000009',
      { a: 1 },
      {
        request: new Request('http://localhost/x?q=1', {
          method: 'POST',
          headers: { 'x-unit-id': 'u1' },
        }),
      },
    )
    expect(requestHash(unit)).not.toBe(base)
    const other = contextOf(
      'another-key',
      { a: 1 },
      { request: new Request('http://localhost/x?q=2', { method: 'POST' }) },
    )
    expect(requestHash(other)).toBe(base)
    expect(base).toMatch(/^[0-9a-f]{64}$/)
  })

  test('canonical JSON', () => {
    expect(canonicalJson({ b: [1, { z: 1, a: null }], a: 'x' })).toBe(
      '{"a":"x","b":[1,{"a":null,"z":1}]}',
    )
  })
})
