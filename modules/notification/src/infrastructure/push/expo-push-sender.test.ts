import { describe, expect, test } from 'bun:test'
import type { Log } from '@core/kernel'
import { RetryLaterError } from '@core/messaging'
import type { MetricsPort } from '@rms/shared-types'
import type { ExpoMessage } from '../../application/push-sender'
import { ExpoPushSender, type PushFetch } from './expo-push-sender'

const BASE = 'https://push.test/--/api/v2/push'

const message = (to: string): ExpoMessage => ({
  to,
  title: 'Tiêu đề',
  body: 'Nội dung',
  data: { route: '/fees', unitId: null, entityId: null },
  channelId: 'default',
  priority: 'default',
  sound: 'default',
})

const silent = { info() {}, warn() {}, error() {} } as unknown as Log

type Reply = { status: number; body?: unknown; headers?: Record<string, string> }

/** A fake Expo endpoint: one reply per call, the last one repeated; it records every request. */
function endpoint(replies: Reply[]) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  let next = 0
  const fetch: PushFetch = async (url, init) => {
    calls.push({ url, init })
    const reply = replies[Math.min(next, replies.length - 1)]!
    next++
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: reply.headers,
    })
  }
  return { fetch, calls }
}

const waits: number[] = []
const noWait = async (milliseconds: number) => {
  waits.push(milliseconds)
}

function sender(
  fetch: PushFetch,
  opts: { token?: string | null; log?: Log; metrics?: MetricsPort } = {},
) {
  waits.length = 0
  return new ExpoPushSender(
    fetch,
    BASE,
    opts.token === undefined ? 'secret-token' : opts.token,
    10_000,
    noWait,
    opts.log ?? silent,
    opts.metrics,
  )
}

describe('NT-53: a 5xx is retried inside one attempt (DOC-31 §6.2 step 6)', () => {
  test('500, 500, 200 is one send with the waits of 1 s and 5 s', async () => {
    const { fetch, calls } = endpoint([
      { status: 500 },
      { status: 500 },
      { status: 200, body: { data: [{ status: 'ok', id: 't1' }] } },
    ])
    const tickets = await sender(fetch).send([message('ExpoPushToken[a]')])
    expect(tickets).toEqual([{ status: 'ok', id: 't1' }])
    expect(calls).toHaveLength(3)
    expect(waits).toEqual([1000, 5000])
  })

  test('500 three times throws, and the attempt is spent', async () => {
    const { fetch, calls } = endpoint([{ status: 500 }, { status: 500 }, { status: 500 }])
    const error = await sender(fetch)
      .send([message('ExpoPushToken[a]')])
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(RetryLaterError)
    expect(calls).toHaveLength(3)
  })
})

describe('NT-54: a 429 defers the message (DOC-31 §6.2 step 6)', () => {
  test('429 three times with Retry-After: 12 gives RetryLaterError with 12 s', async () => {
    const rateLimited: Reply = { status: 429, headers: { 'retry-after': '12' } }
    const { fetch, calls } = endpoint([rateLimited, rateLimited, rateLimited])
    const error = await sender(fetch)
      .send([message('ExpoPushToken[a]')])
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(RetryLaterError)
    expect((error as RetryLaterError).retryAfterMs).toBe(12_000)
    expect(calls).toHaveLength(3)
    expect(waits).toEqual([1000, 5000])
  })
})

describe('NT-55: a 401 defers 300 s and raises provider_auth_failed (DOC-31 §6.2 step 6)', () => {
  test('the token is wrong: one call, the metric and the error line', async () => {
    const counted: Array<{ name: string; labels?: Record<string, string> }> = []
    const metrics = {
      inc: (name: string, labels?: Record<string, string>) => void counted.push({ name, labels }),
      add() {},
      observe() {},
    } as unknown as MetricsPort
    const errors: unknown[] = []
    const log = {
      info() {},
      warn() {},
      error: (fields: unknown) => void errors.push(fields),
    } as unknown as Log
    const { fetch, calls } = endpoint([{ status: 401 }])
    const error = await sender(fetch, { log, metrics })
      .send([message('ExpoPushToken[a]')])
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(RetryLaterError)
    expect((error as RetryLaterError).retryAfterMs).toBe(300_000)
    expect(calls).toHaveLength(1)
    expect(counted).toEqual([{ name: 'provider_auth_failed_total', labels: { provider: 'push' } }])
    expect(errors).toEqual([
      expect.objectContaining({ event: 'provider_auth_failed', provider: 'push' }),
    ])
  })
})

describe('the Expo request of DOC-31 §6.3', () => {
  test('the /send body, the headers and the Authorization when a token is set', async () => {
    const { fetch, calls } = endpoint([
      { status: 200, body: { data: [{ status: 'ok', id: 't1' }] } },
    ])
    const messages = [message('ExpoPushToken[a]')]
    await sender(fetch, { token: 'tok' }).send(messages)
    const call = calls[0]!
    expect(call.url).toBe(`${BASE}/send`)
    expect(call.init.method).toBe('POST')
    expect(call.init.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer tok',
    })
    expect(JSON.parse(String(call.init.body))).toEqual(messages)
  })

  test('no Authorization when no token is set', async () => {
    const { fetch, calls } = endpoint([{ status: 200, body: { data: [] } }])
    await sender(fetch, { token: null }).send([message('ExpoPushToken[a]')])
    expect(calls[0]!.init.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    })
  })

  test('a run of 250 messages is sent in chunks of 100', async () => {
    const urls: string[] = []
    const sizes: number[] = []
    const fetch: PushFetch = async (url, init) => {
      urls.push(url)
      const body = JSON.parse(String(init.body)) as unknown[]
      sizes.push(body.length)
      const data = body.map((_, index) => ({ status: 'ok', id: `t${index}` }))
      return new Response(JSON.stringify({ data }), { status: 200 })
    }
    const messages = Array.from({ length: 250 }, (_, index) => message(`ExpoPushToken[${index}]`))
    const tickets = await sender(fetch).send(messages)
    expect(sizes).toEqual([100, 100, 50])
    expect(urls).toEqual([`${BASE}/send`, `${BASE}/send`, `${BASE}/send`])
    expect(tickets).toHaveLength(250)
  })

  test('getReceipts asks for the ids and reads the map of §6.3', async () => {
    const { fetch, calls } = endpoint([
      {
        status: 200,
        body: {
          data: {
            a: { status: 'ok' },
            b: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
          },
        },
      },
    ])
    const receipts = await sender(fetch).getReceipts(['a', 'b'])
    expect(receipts).toEqual({
      a: { status: 'ok' },
      b: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(`${BASE}/getReceipts`)
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ ids: ['a', 'b'] })
  })
})
