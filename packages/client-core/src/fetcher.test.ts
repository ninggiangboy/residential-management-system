import { describe, expect, test } from 'bun:test'
import { ApiException } from './errors'
import {
  createAuthenticatedFetch,
  type Gates,
  type RefreshResult,
  type TokenStore,
} from './fetcher'

const BASE = 'http://api.test/api/v1'

function harness(
  options: {
    token?: string | null
    expiresAt?: number
    refresh?: () => Promise<RefreshResult>
  } = {},
) {
  let token: string | null = options.token === undefined ? 'old' : options.token
  let expiresAt: number | null = options.expiresAt ?? Date.now() + 600_000
  const seen: Array<{ url: string; method: string; headers: Headers }> = []
  const calls = {
    refresh: 0,
    signedOut: [] as string[],
    sleeps: [] as number[],
    terms: 0,
    upgrade: 0,
  }
  const queue: Array<(request: { url: string; headers: Headers }) => Response | Promise<Response>> =
    []
  let counter = 0
  const tokens: TokenStore = {
    accessToken: () => token,
    accessExpiresAt: () => expiresAt,
    setAccessToken: (next) => {
      token = next?.token ?? null
      expiresAt = next?.expiresAt ?? null
    },
  }
  const gates: Gates = {
    termsRequired: async () => {
      calls.terms++
    },
    upgradeRequired: () => {
      calls.upgrade++
    },
    signedOut: (reason) => {
      calls.signedOut.push(reason)
    },
    language: () => 'vi',
    unitId: () => null,
  }
  const refresh =
    options.refresh ??
    (async () => {
      calls.refresh++
      await Bun.sleep(5)
      return { status: 'ok', accessToken: 'new', expiresAt: Date.now() + 600_000 } as const
    })
  const fetcher = createAuthenticatedFetch({
    env: { app: 'web', baseUrl: BASE },
    tokens,
    gates,
    refresh,
    randomId: () => `id-${++counter}`,
    sleep: async (ms) => {
      calls.sleeps.push(ms)
    },
    fetchImpl: (async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers)
      seen.push({ url: String(url), method: String(init.method), headers })
      const next = queue.shift()
      if (!next) throw new Error('unexpected request')
      return next({ url: String(url), headers })
    }) as unknown as typeof fetch,
  })
  return { fetcher, seen, calls, queue, token: () => token }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
const unauthenticated = () => json(401, { error: { code: 'unauthenticated', message: 'x' } })
const ok = () => json(200, { ok: true })

describe('headers', () => {
  test('a call carries the bearer, the language, the app id and a request id', async () => {
    const h = harness()
    h.queue.push(ok)
    await h.fetcher(`${BASE}/staff/me`)
    const headers = h.seen[0]!.headers
    expect(headers.get('authorization')).toBe('Bearer old')
    expect(headers.get('accept-language')).toBe('vi')
    expect(headers.get('x-app-id')).toBe('web')
    expect(headers.get('x-request-id')).toBe('id-1')
  })

  test('public and auth routes carry no bearer; refresh and logout carry X-Requested-With', async () => {
    const h = harness()
    h.queue.push(ok, ok, ok)
    await h.fetcher(`${BASE}/public/config`)
    await h.fetcher(`${BASE}/auth/staff/login`, { method: 'POST' })
    await h.fetcher(`${BASE}/auth/refresh`, { method: 'POST' })
    expect(h.seen.map((s) => s.headers.get('authorization'))).toEqual([null, null, null])
    expect(h.seen.map((s) => s.headers.get('x-requested-with'))).toEqual([null, null, 'rms'])
  })

  test('the error body gains the request id of the answer', async () => {
    const h = harness()
    h.queue.push(() =>
      json(
        422,
        { error: { code: 'validation_failed', message: 'x' } },
        { 'x-request-id': 'srv-9' },
      ),
    )
    const response = await h.fetcher(`${BASE}/staff/units`, { method: 'POST' })
    expect(((await response.json()) as { error: { requestId: string } }).error.requestId).toBe(
      'srv-9',
    )
  })
})

describe('refresh', () => {
  test('CL-10: five calls get 401 at once, one refresh, five replays with their own keys', async () => {
    const h = harness()
    const keys = ['k1', 'k2', 'k3', 'k4', 'k5']
    for (let i = 0; i < 5; i++) h.queue.push(unauthenticated)
    for (let i = 0; i < 5; i++) h.queue.push(ok)
    const responses = await Promise.all(
      keys.map((key) =>
        h.fetcher(`${BASE}/staff/units`, { method: 'POST', headers: { 'idempotency-key': key } }),
      ),
    )
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
    expect(h.calls.refresh).toBe(1)
    const replays = h.seen.slice(5)
    expect(replays.map((s) => s.headers.get('idempotency-key')).sort()).toEqual(keys)
    expect(new Set(replays.map((s) => s.headers.get('authorization')))).toEqual(
      new Set(['Bearer new']),
    )
    expect(new Set(h.seen.map((s) => s.headers.get('x-request-id'))).size).toBe(10)
  })

  test('a token that expires within 30 s is refreshed before the call', async () => {
    const h = harness({ expiresAt: Date.now() + 10_000 })
    h.queue.push(ok)
    await h.fetcher(`${BASE}/staff/me`)
    expect(h.calls.refresh).toBe(1)
    expect(h.seen[0]!.headers.get('authorization')).toBe('Bearer new')
  })

  test('CL-11: a refresh answered 401 signs out once and clears the token', async () => {
    const h = harness({ refresh: async () => ({ status: 'denied' }) })
    h.queue.push(unauthenticated, unauthenticated)
    const [a, b] = await Promise.all([
      h.fetcher(`${BASE}/staff/me`),
      h.fetcher(`${BASE}/staff/units`),
    ])
    expect([a.status, b.status]).toEqual([401, 401])
    expect(h.calls.signedOut).toEqual(['refresh_failed'])
    expect(h.token()).toBeNull()
  })

  test('CL-11: a refresh with no answer is retried after 1 s and 3 s, then the state is unknown and the token stays', async () => {
    let tries = 0
    const h = harness({
      refresh: async () => {
        tries++
        return { status: 'unknown' }
      },
    })
    h.queue.push(unauthenticated)
    await expect(h.fetcher(`${BASE}/staff/me`)).rejects.toBeInstanceOf(ApiException)
    expect(tries).toBe(3)
    expect(h.calls.sleeps).toEqual([1000, 3000])
    expect(h.calls.signedOut).toEqual([])
    expect(h.token()).toBe('old')
  })

  test('CL-12: a replay that is 401 again signs out without a second refresh', async () => {
    const h = harness()
    h.queue.push(unauthenticated, unauthenticated)
    const response = await h.fetcher(`${BASE}/staff/me`)
    expect(response.status).toBe(401)
    expect(h.calls.refresh).toBe(1)
    expect(h.calls.signedOut).toEqual(['refresh_failed'])
  })
})

describe('retries and gates', () => {
  test('a GET that gets 503 is retried and then succeeds', async () => {
    const h = harness()
    h.queue.push(() => json(503, { error: { code: 'service_unavailable', message: 'x' } }), ok)
    expect((await h.fetcher(`${BASE}/staff/units`)).status).toBe(200)
    expect(h.calls.sleeps).toEqual([1000])
  })

  test('a write with a key keeps its key across a 429 retry', async () => {
    const h = harness()
    h.queue.push(
      () => json(429, { error: { code: 'rate_limited', message: 'x' } }, { 'retry-after': '1' }),
      ok,
    )
    await h.fetcher(`${BASE}/staff/units`, {
      method: 'POST',
      headers: { 'idempotency-key': 'abc-12345' },
    })
    expect(h.seen.map((s) => s.headers.get('idempotency-key'))).toEqual(['abc-12345', 'abc-12345'])
    expect(h.calls.sleeps).toEqual([1000])
  })

  test('a 409 version_conflict is returned at once', async () => {
    const h = harness()
    h.queue.push(() => json(409, { error: { code: 'version_conflict', message: 'x' } }))
    expect((await h.fetcher(`${BASE}/staff/me`, { method: 'PATCH' })).status).toBe(409)
    expect(h.seen).toHaveLength(1)
  })

  test('a write without a key that gets no answer throws "network" and is not replayed', async () => {
    const h = harness()
    h.queue.push(() => {
      throw new TypeError('fetch failed')
    })
    await expect(h.fetcher(`${BASE}/staff/units`, { method: 'POST' })).rejects.toMatchObject({
      error: { code: 'network' },
    })
    expect(h.seen).toHaveLength(1)
  })

  test('terms_required waits for the gate and replays once', async () => {
    const h = harness()
    h.queue.push(
      () => json(403, { error: { code: 'terms_required', message: 'x', details: {} } }),
      ok,
    )
    expect((await h.fetcher(`${BASE}/me`)).status).toBe(200)
    expect(h.calls.terms).toBe(1)
  })

  test('upgrade_required calls the gate and returns the answer', async () => {
    const h = harness()
    h.queue.push(() =>
      json(426, {
        error: { code: 'upgrade_required', message: 'x', details: { minVersion: '2.0.0' } },
      }),
    )
    expect((await h.fetcher(`${BASE}/me`)).status).toBe(426)
    expect(h.calls.upgrade).toBe(1)
  })
})
