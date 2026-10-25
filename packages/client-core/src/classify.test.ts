import { describe, expect, test } from 'bun:test'
import { ERROR_CODES, RULE_CODES } from '@rms/shared-types'
import { type ClientAction, classify } from './classify'
import { apiErrorFromBody, parseApiError } from './errors'

describe('CL-07: classify has an action for every code of DOC-42 §5', () => {
  test.each([...ERROR_CODES, ...RULE_CODES])('%s', (code) => {
    expect(classify({ status: 400, code })).toHaveProperty('kind')
  })
})

describe('CL-08: an unknown code falls back to its status class', () => {
  test.each<[number, ClientAction['kind']]>([
    [409, 'conflict_message'],
    [500, 'server_error'],
    [404, 'not_found'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
    [503, 'offline'],
    [422, 'validation'],
  ])('%d', (status, kind) => {
    expect(classify({ status, code: 'some_new_code' }).kind).toBe(kind)
  })
})

test('the rows of DOC-55 §6', () => {
  expect(classify({ status: 401, code: 'unauthenticated' })).toEqual({ kind: 'refresh' })
  expect(classify({ status: 403, code: 'step_up_required' })).toEqual({
    kind: 'step_up',
    failed: false,
  })
  expect(classify({ status: 403, code: 'step_up_failed' })).toEqual({
    kind: 'step_up',
    failed: true,
  })
  expect(classify({ status: 409, code: 'version_conflict' })).toEqual({
    kind: 'conflict_refetch',
    conflict: 'version',
  })
  expect(classify({ status: 409, code: 'ticket_closed' })).toEqual({
    kind: 'conflict_refetch',
    conflict: 'ticket',
  })
  expect(classify({ status: 409, code: 'phone_in_use' })).toEqual({ kind: 'conflict_message' })
  expect(classify({ status: 409, code: 'request_in_progress' })).toEqual({ kind: 'retry_same_key' })
  expect(classify({ status: 0, code: 'network' })).toEqual({ kind: 'offline' })
  expect(classify({ status: 423, code: 'account_locked' })).toEqual({ kind: 'locked' })
})

describe('CL-09: parseApiError', () => {
  test('the project shape keeps code, details and the headers', async () => {
    const response = new Response(
      JSON.stringify({
        error: { code: 'rate_limited', message: 'Slow down', details: { retryAfter: 4 } },
      }),
      {
        status: 429,
        headers: {
          'retry-after': '4',
          'x-request-id': 'req-1',
          'content-type': 'application/json',
        },
      },
    )
    expect(await parseApiError(response)).toEqual({
      status: 429,
      code: 'rate_limited',
      message: 'Slow down',
      details: { retryAfter: 4 },
      requestId: 'req-1',
      retryAfter: 4,
      replayed: false,
    })
  })

  test('an HTML 502 from a proxy is code unknown and keeps its status', async () => {
    const response = new Response('<html>Bad gateway</html>', {
      status: 502,
      statusText: 'Bad Gateway',
    })
    expect(await parseApiError(response, 'local-id')).toMatchObject({
      status: 502,
      code: 'unknown',
      message: 'Bad Gateway',
      requestId: 'local-id',
    })
  })

  test('a replayed answer is flagged', async () => {
    const response = new Response('{}', { status: 200, headers: { 'idempotent-replayed': 'true' } })
    expect((await parseApiError(response)).replayed).toBe(true)
  })

  test('a parsed body gives the same error', () => {
    expect(
      apiErrorFromBody(409, { error: { code: 'version_conflict', message: 'm', requestId: 'r' } }),
    ).toMatchObject({
      code: 'version_conflict',
      requestId: 'r',
    })
  })
})
