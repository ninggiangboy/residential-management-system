import { describe, expect, test } from 'bun:test'
import { retryPlan } from './retry'

const answer = (status: number, code = 'x', retryAfter?: number) => ({ status, code, retryAfter })

describe('CL-01…05: the retry table of DOC-55 §4.3', () => {
  test('CL-01: GET + 503 with Retry-After 2 retries after 2 s, at most 2 times', () => {
    const request = { method: 'GET', hasKey: false }
    expect(retryPlan(request, answer(503, 'service_unavailable', 2), 0)).toEqual({
      retry: true,
      afterMs: 2000,
    })
    expect(retryPlan(request, answer(503, 'service_unavailable', 2), 1)).toEqual({
      retry: true,
      afterMs: 2000,
    })
    expect(retryPlan(request, answer(503, 'service_unavailable', 2), 2)).toEqual({
      retry: false,
      reason: 'exhausted',
    })
  })

  test('a GET with a network failure waits 1 s then 3 s', () => {
    const request = { method: 'GET', hasKey: false }
    expect(retryPlan(request, answer(0, 'network'), 0)).toEqual({ retry: true, afterMs: 1000 })
    expect(retryPlan(request, answer(0, 'network'), 1)).toEqual({ retry: true, afterMs: 3000 })
    expect(retryPlan(request, answer(0, 'network'), 2).retry).toBe(false)
  })

  test('a GET with 500 retries once; a GET with 404 never', () => {
    const request = { method: 'GET', hasKey: false }
    expect(retryPlan(request, answer(500), 0).retry).toBe(true)
    expect(retryPlan(request, answer(500), 1).retry).toBe(false)
    expect(retryPlan(request, answer(404), 0)).toEqual({ retry: false, reason: 'final' })
  })

  test('a GET with 429 waits Retry-After, default 2 s, at most 2 times', () => {
    const request = { method: 'GET', hasKey: false }
    expect(retryPlan(request, answer(429), 0)).toEqual({ retry: true, afterMs: 2000 })
    expect(retryPlan(request, answer(429, 'rate_limited', 5), 1)).toEqual({
      retry: true,
      afterMs: 5000,
    })
    expect(retryPlan(request, answer(429), 2).retry).toBe(false)
  })

  test('CL-02: POST with a key + 429 waits Retry-After, at most 3 tries', () => {
    const request = { method: 'POST', hasKey: true }
    for (const attempt of [0, 1, 2])
      expect(retryPlan(request, answer(429, 'rate_limited', 3), attempt)).toEqual({
        retry: true,
        afterMs: 3000,
      })
    expect(retryPlan(request, answer(429, 'rate_limited', 3), 3)).toEqual({
      retry: false,
      reason: 'exhausted',
    })
  })

  test('CL-04: 409 request_in_progress with a key retries after 1 s with the same key', () => {
    expect(
      retryPlan({ method: 'POST', hasKey: true }, answer(409, 'request_in_progress'), 0),
    ).toEqual({
      retry: true,
      afterMs: 1000,
    })
  })

  test('a write with a key retries a network failure and a 503', () => {
    const request = { method: 'PATCH', hasKey: true }
    expect(retryPlan(request, answer(0, 'network'), 0).retry).toBe(true)
    expect(retryPlan(request, answer(503, 'service_unavailable'), 0).retry).toBe(true)
    expect(retryPlan(request, answer(500), 0)).toEqual({ retry: false, reason: 'final' })
    expect(retryPlan(request, answer(422), 0)).toEqual({ retry: false, reason: 'final' })
  })

  test('CL-03: a write without a key is "not sent" on a network failure and on 5xx', () => {
    const request = { method: 'POST', hasKey: false }
    expect(retryPlan(request, answer(0, 'network'), 0)).toEqual({
      retry: false,
      reason: 'not_sent',
    })
    expect(retryPlan(request, answer(502), 0)).toEqual({ retry: false, reason: 'not_sent' })
  })

  test('a write without a key retries a 429 once', () => {
    const request = { method: 'POST', hasKey: false }
    expect(retryPlan(request, answer(429), 0).retry).toBe(true)
    expect(retryPlan(request, answer(429), 1).retry).toBe(false)
  })

  test('CL-05: PATCH + 409 version_conflict is never retried', () => {
    expect(
      retryPlan({ method: 'PATCH', hasKey: true }, answer(409, 'version_conflict'), 0),
    ).toEqual({
      retry: false,
      reason: 'final',
    })
    expect(
      retryPlan({ method: 'PATCH', hasKey: false }, answer(409, 'version_conflict'), 0).retry,
    ).toBe(false)
  })
})
