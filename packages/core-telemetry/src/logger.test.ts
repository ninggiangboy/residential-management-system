import { describe, expect, test } from 'bun:test'
import { requestContext } from '@core/context'
import { createLogger, serializeError } from './logger'

function capture(level = 'debug') {
  const lines: Record<string, unknown>[] = []
  const logger = createLogger(level, {
    service: 'api',
    destination: { write: (chunk: string) => void lines.push(JSON.parse(chunk)) },
  })
  return { logger, lines }
}

class PgError extends Error {
  readonly code = '23505'
  readonly constraint_name = 'uq_phone'
  readonly table_name = 'resident_account'
  readonly detail = 'Key (phone)=(+84901234567) already exists.'
  readonly where = 'SQL statement "insert … values (+84901234567)"'
}

describe('the logger (DOC-40 §3.1, DOC-42 §8)', () => {
  test('OB-10 every line has time, level as a word, msg, service and the request id inside a request', () => {
    const { logger, lines } = capture()
    requestContext.run({ requestId: 'req-1', correlationId: 'corr-1' }, () =>
      logger.info({ route: '/x' }, 'request'),
    )
    logger.info({}, 'boot')
    expect(lines[0]).toMatchObject({
      level: 'info',
      service: 'api',
      msg: 'request',
      requestId: 'req-1',
      correlationId: 'corr-1',
      route: '/x',
    })
    expect(lines[0]?.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(lines[1]).toMatchObject({ level: 'info', msg: 'boot' })
    expect(lines[1]?.requestId).toBeUndefined()
  })

  test('secrets named by DOC-42 §8.3 are redacted, a top-level `code` is not', () => {
    const { logger, lines } = capture()
    logger.info(
      {
        code: 'not_found',
        password: 'p',
        user: { token: 't', otp: '123456', cccd: '0123' },
        req: { headers: { authorization: 'Bearer abc', cookie: 'a=b', accept: '*/*' } },
      },
      'x',
    )
    const text = JSON.stringify(lines[0])
    for (const secret of ['"p"', '"t"', '123456', '0123', 'Bearer abc', 'a=b'])
      expect(text).not.toContain(secret)
    expect(lines[0]).toMatchObject({ code: 'not_found' })
    expect((lines[0] as { req: { headers: { accept: string } } }).req.headers.accept).toBe('*/*')
  })

  test('ER-30 a database error is logged by SQLSTATE, constraint, table and column: never its detail or where', () => {
    const { logger, lines } = capture()
    logger.error(
      { err: new PgError('duplicate key value violates unique constraint "uq_phone"') },
      'unhandled_error',
    )
    const line = lines[0] as { err: { sql: Record<string, string>; message: string } }
    expect(line.err.sql).toEqual({
      sqlstate: '23505',
      constraint: 'uq_phone',
      table: 'resident_account',
    })
    expect(JSON.stringify(line)).not.toContain('+84901234567')
  })

  test('the cause chain is logged to depth 3 and a stack is cut', () => {
    let error: Error = new Error('level 5')
    for (let level = 4; level >= 0; level--) error = new Error(`level ${level}`, { cause: error })
    const serialized = serializeError(error)
    expect(serialized.cause?.cause?.cause?.message).toBe('level 3')
    expect(serialized.cause?.cause?.cause?.cause).toBeUndefined()
    const long = new Error('x')
    long.stack = 'y'.repeat(40_000)
    expect(serializeError(long).stack).toHaveLength(16 * 1024)
  })

  test('a thrown value that is not an Error still serializes', () => {
    expect(serializeError('boom')).toEqual({ type: 'string', message: 'boom' })
  })
})
