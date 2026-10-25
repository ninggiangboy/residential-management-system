import { describe, expect, test } from 'bun:test'
import {
  type ClientErrorBody,
  cleanText,
  createErrorReporter,
  MAX_STACK_BYTES,
  truncateBytes,
} from './reporter'

function setup(
  overrides: { enabled?: boolean; send?: (b: ClientErrorBody) => Promise<unknown> } = {},
) {
  const bodies: ClientErrorBody[] = []
  let at = 1_000_000
  const reporter = createErrorReporter({
    app: 'web',
    platform: 'web',
    appVersion: '1.0.3',
    now: () => at,
    send:
      overrides.send ??
      (async (body) => {
        bodies.push(body)
      }),
    ...(overrides.enabled === undefined ? {} : { enabled: overrides.enabled }),
  })
  return { reporter, bodies, advance: (ms: number) => (at += ms) }
}

describe('the throttle', () => {
  test('CL-18 six different reports in a minute: five are sent', () => {
    const { reporter, bodies } = setup()
    const results = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => {
      const error = new Error('boom')
      error.name = name
      return reporter.report({ kind: 'render', error })
    })
    expect(results).toEqual([true, true, true, true, true, false])
    expect(bodies).toHaveLength(5)
  })

  test('CL-18 the same (kind, errorName, screen) twice: one is sent per ten minutes', () => {
    const { reporter, bodies, advance } = setup()
    const input = { kind: 'render' as const, error: new TypeError('x'), screen: '/units' }
    expect(reporter.report(input)).toBe(true)
    advance(9 * 60_000)
    expect(reporter.report(input)).toBe(false)
    advance(61_000)
    expect(reporter.report(input)).toBe(true)
    expect(bodies).toHaveLength(2)
  })

  test('another kind or another screen is another report', () => {
    const { reporter } = setup()
    const error = new TypeError('x')
    expect(reporter.report({ kind: 'render', error, screen: '/units' })).toBe(true)
    expect(reporter.report({ kind: 'crash', error, screen: '/units' })).toBe(true)
    expect(reporter.report({ kind: 'render', error, screen: '/residents' })).toBe(true)
  })

  test('the minute is a sliding window: a sixth report a minute later is sent', () => {
    const { reporter, advance } = setup()
    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      const error = new Error('boom')
      error.name = name
      reporter.report({ kind: 'crash', error })
    }
    advance(60_000)
    expect(reporter.report({ kind: 'crash', error: new Error('late') })).toBe(true)
  })

  test('a development build reports nothing', () => {
    const { reporter, bodies } = setup({ enabled: false })
    const original = console.error
    console.error = () => undefined
    try {
      expect(reporter.report({ kind: 'crash', error: new Error('x') })).toBe(false)
    } finally {
      console.error = original
    }
    expect(bodies).toHaveLength(0)
  })

  test('a failing send is dropped silently', async () => {
    const { reporter } = setup({ send: async () => Promise.reject(new Error('offline')) })
    expect(reporter.report({ kind: 'network', error: new Error('x') })).toBe(true)
    await Promise.resolve()
  })
})

describe('the body', () => {
  test('CL-19 a URL with a query string or a fragment loses both, in the message and the stack', () => {
    const { reporter, bodies } = setup()
    const error = new Error(
      'GET https://api.example.vn/api/v1/staff/residents?q=0901234567&limit=50 failed',
    )
    error.stack =
      'Error\n    at fetch (https://rms.example.vn/assets/app.js?v=3:1:2)\n    at /residents?q=an (x)'
    reporter.report({ kind: 'network', error, screen: '/residents?q=an' })
    const [body] = bodies
    expect(body?.message).toBe('GET https://api.example.vn/api/v1/staff/residents failed')
    expect(body?.stack).not.toContain('?')
    expect(body?.stack).toContain('https://rms.example.vn/assets/app.js')
    expect(body?.screen).toBe('/residents')
  })

  test('CL-19 a bearer token is redacted', () => {
    expect(cleanText('Authorization: Bearer eyJhbGciOi.abc.def failed')).toBe(
      'Authorization: Bearer [redacted] failed',
    )
  })

  test('the keys are the ones of E-04 and nothing else', () => {
    const { reporter, bodies } = setup()
    reporter.report({ kind: 'crash', error: new RangeError('r'), requestId: 'req-1' })
    expect(bodies[0]).toEqual({
      app: 'web',
      appVersion: '1.0.3',
      platform: 'web',
      kind: 'crash',
      errorName: 'RangeError',
      message: 'r',
      stack: expect.any(String),
      requestId: 'req-1',
    })
  })

  test('the message stops at 500 characters, the stack at 4 KB of UTF-8 without splitting a character', () => {
    const { reporter, bodies } = setup()
    const error = new Error('m'.repeat(900))
    error.stack = '€'.repeat(3000)
    reporter.report({ kind: 'crash', error })
    expect(bodies[0]?.message).toHaveLength(500)
    const bytes = new TextEncoder().encode(bodies[0]?.stack ?? '').length
    expect(bytes).toBeLessThanOrEqual(MAX_STACK_BYTES)
    expect(bodies[0]?.stack).toBe('€'.repeat(1365))
    expect(truncateBytes('a😀b', 4)).toBe('a')
  })

  test('a thrown string or object is named NonError and carries no object content', () => {
    const { reporter, bodies } = setup()
    reporter.report({ kind: 'unhandled_rejection', error: { token: 'secret' } })
    expect(bodies[0]).toMatchObject({ errorName: 'NonError' })
    expect(JSON.stringify(bodies[0])).not.toContain('secret')
  })
})
