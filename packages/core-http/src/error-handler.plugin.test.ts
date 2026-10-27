import { describe, expect, test } from 'bun:test'
import {
  BadGatewayError,
  ConflictError,
  DomainError,
  ForbiddenError,
  InvariantError,
  LockedError,
  NotFoundError,
  PayloadTooLargeError,
  PreconditionRequiredError,
  RateLimitedError,
  RuleViolationError,
  UnauthorizedError,
  UnavailableError,
  UpgradeRequiredError,
  ValidationError,
  VersionConflictError,
} from '@core/kernel'
import { createLogger, serializeError } from '@core/telemetry'
import { Elysia, t } from 'elysia'
import { errorHandlerPlugin } from './error-handler.plugin'
import { requestContextPlugin } from './request-context.plugin'
import { describedEnum } from './routes'

const lines: Record<string, unknown>[] = []
const logger = createLogger('error')
// What reaches the line is what the `err` serializer of the real logger makes of it.
logger.error = ((fields: { err?: unknown }, msg: string) =>
  lines.push({ ...fields, err: serializeError(fields.err), msg })) as unknown as typeof logger.error

class PgError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly constraint_name?: string,
    readonly detail?: string,
  ) {
    super(message)
  }
}

function app(constraintErrors = {}) {
  return new Elysia({ normalize: false })
    .use(requestContextPlugin)
    .use(errorHandlerPlugin({ logger, constraintErrors }))
    .get('/throw/:what', ({ params }) => {
      throw THROWN[params.what]?.()
    })
    .post('/enum', () => 'ok', {
      body: t.Object({ kind: describedEnum({ a: 'The first', b: 'The second' }) }),
    })
    .post('/body', () => 'ok', {
      body: t.Object(
        {
          reason: t.String({ minLength: 5, maxLength: 20 }),
          n: t.Integer({ minimum: 1 }),
          lines: t.Array(t.Object({ amount: t.Integer({ minimum: 0 }) })),
        },
        { additionalProperties: false },
      ),
    })
}

const THROWN: Record<string, () => unknown> = {
  validation: () => new ValidationError([{ path: 'a', code: 'required', message: 'm' }]),
  rule: () => new RuleViolationError('reason_too_short', 'Write at least 5 characters.', 'reason'),
  unauthorized: () => new UnauthorizedError('unauthenticated'),
  forbidden: () => new ForbiddenError('forbidden'),
  notFound: () => new NotFoundError(),
  conflict: () => new ConflictError('charge_changed'),
  version: () => new VersionConflictError({ id: 1, version: 4 }),
  precondition: () => new PreconditionRequiredError(),
  tooLarge: () => new PayloadTooLargeError('payload_too_large', 'x', { details: { maxBytes: 10 } }),
  upgrade: () => new UpgradeRequiredError('1.0.0', 'https://store.example/app'),
  locked: () => new LockedError(120),
  rate: () => new RateLimitedError('otp', 7.2),
  unavailable: () => new UnavailableError(),
  badGateway: () => new BadGatewayError(),
  invariant: () => new InvariantError('no transaction is open'),
  unexpected: () => new Error('boom: +84901234567'),
  pgBusy: () => new PgError('40P01', 'deadlock detected'),
  pgTimeout: () => new PgError('57014', 'canceling statement'),
  pgGone: () => new PgError('08006', 'connection failure'),
  pgUnique: () =>
    new PgError('23505', 'duplicate key', 'uq_phone', 'Key (phone)=(+84901234567) already exists.'),
  pgUnmapped: () =>
    new PgError('23505', 'duplicate key', 'uq_other', 'Key (x)=(1) already exists.'),
  pgCheck: () => new PgError('23514', 'violates check', 'ck_amount'),
  pgPrivilege: () => new PgError('42501', 'permission denied'),
}

async function call(a: ReturnType<typeof app>, path: string, init?: RequestInit) {
  const res = await a.handle(new Request(`http://localhost${path}`, init))
  return {
    res,
    body: (await res.json()) as { error: { code: string; message: string; details?: unknown } },
  }
}

describe('ER-01: every class answers with the shape of DOC-42 §3 and its status', () => {
  const expected: [string, number, string][] = [
    ['validation', 400, 'validation_failed'],
    ['rule', 422, 'validation_failed'],
    ['unauthorized', 401, 'unauthenticated'],
    ['forbidden', 403, 'forbidden'],
    ['notFound', 404, 'not_found'],
    ['conflict', 409, 'charge_changed'],
    ['version', 409, 'version_conflict'],
    ['precondition', 428, 'precondition_required'],
    ['tooLarge', 413, 'payload_too_large'],
    ['upgrade', 426, 'upgrade_required'],
    ['locked', 423, 'account_locked'],
    ['rate', 429, 'rate_limited'],
    ['unavailable', 503, 'service_unavailable'],
    ['badGateway', 502, 'bad_gateway'],
    ['invariant', 500, 'internal_error'],
    ['unexpected', 500, 'internal_error'],
  ]
  for (const [what, status, code] of expected)
    test(`${what} → ${status} ${code}`, async () => {
      const { res, body } = await call(app(), `/throw/${what}`)
      expect(res.status).toBe(status)
      expect(body.error.code).toBe(code)
      expect(typeof body.error.message).toBe('string')
      expect(res.headers.get('x-request-id')).toBeTruthy()
      expect(res.headers.get('content-type')).toContain('application/json')
      expect(res.headers.get('cache-control')).toBe('no-store')
    })

  test('details carry the keys the catalog lists and a stale version carries the fresh resource', async () => {
    expect((await call(app(), '/throw/upgrade')).body.error.details).toEqual({
      minVersion: '1.0.0',
      storeUrl: 'https://store.example/app',
    })
    expect((await call(app(), '/throw/version')).body.error.details).toEqual({
      current: { id: 1, version: 4 },
    })
    expect((await call(app(), '/throw/rate')).body.error.details).toEqual({ scope: 'otp' })
    expect((await call(app(), '/throw/rule')).body.error.details).toEqual([
      { path: 'reason', code: 'reason_too_short', message: 'Write at least 5 characters.' },
    ])
  })
})

describe('ER-04: Retry-After', () => {
  test('is a whole number of seconds on 429, 423 and 503 and absent elsewhere', async () => {
    expect((await call(app(), '/throw/rate')).res.headers.get('retry-after')).toBe('8')
    expect((await call(app(), '/throw/locked')).res.headers.get('retry-after')).toBe('120')
    expect((await call(app(), '/throw/unavailable')).res.headers.get('retry-after')).toBe('1')
    for (const what of ['conflict', 'forbidden', 'unexpected', 'validation'])
      expect((await call(app(), `/throw/${what}`)).res.headers.get('retry-after')).toBeNull()
  })
})

describe('ER-06: a 5xx has no details, no stack and no exception text', () => {
  test('the body of an unexpected error and of an invariant error', async () => {
    for (const what of ['unexpected', 'invariant', 'pgCheck', 'pgPrivilege']) {
      const { res, body } = await call(app(), `/throw/${what}`)
      expect(res.status).toBe(500)
      expect(body).toEqual({ error: { code: 'internal_error', message: 'Internal server error' } })
    }
  })
})

describe('database errors (DOC-42 §4.2)', () => {
  test('ER-07 a mapped unique constraint is its ConflictError, an unmapped one is a 500 with its constraint logged', async () => {
    lines.length = 0
    const mapped = app({ uq_phone: () => new ConflictError('phone_in_use') })
    expect((await call(mapped, '/throw/pgUnique')).body.error.code).toBe('phone_in_use')
    expect((await call(mapped, '/throw/pgUnique')).res.status).toBe(409)
    const unmapped = await call(mapped, '/throw/pgUnmapped')
    expect(unmapped.res.status).toBe(500)
    const line = lines.at(-1) as { err: { sql: { sqlstate: string; constraint: string } } }
    expect(line.err.sql).toEqual({ sqlstate: '23505', constraint: 'uq_other' })
  })

  test('a deadlock, a statement timeout and a lost connection answer 503 service_unavailable with Retry-After', async () => {
    for (const what of ['pgBusy', 'pgTimeout', 'pgGone']) {
      const { res, body } = await call(app(), `/throw/${what}`)
      expect(res.status).toBe(503)
      expect(body.error.code).toBe('service_unavailable')
      expect(res.headers.get('retry-after')).toBe('1')
    }
  })

  test('ER-15 the log line of a database error carries the SQLSTATE and no value of the failing row', async () => {
    lines.length = 0
    await call(app(), '/throw/pgUnmapped')
    await call(app(), '/throw/unexpected')
    const text = JSON.stringify(lines)
    expect(text).toContain('23505')
    expect(text).not.toContain('Key (x)=(1)')
  })
})

describe('schema violations', () => {
  const send = (body: unknown) =>
    call(app(), '/body', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  test('ER-19 are 400 validation_failed with a dotted path and the rule code of DOC-42 §5.2', async () => {
    const { res, body } = await send({ reason: 'abc', n: 0, lines: [{ amount: -1 }], foo: 1 })
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('validation_failed')
    const details = body.error.details as { path: string; code: string }[]
    expect(details).toContainEqual(expect.objectContaining({ path: 'reason', code: 'min_length' }))
    expect(details).toContainEqual(expect.objectContaining({ path: 'n', code: 'minimum' }))
    expect(details).toContainEqual(
      expect.objectContaining({ path: 'lines[0].amount', code: 'minimum' }),
    )
    expect(details).toContainEqual(expect.objectContaining({ path: 'foo', code: 'unknown_key' }))
  })

  test('a value outside a described enum is the rule enum and lists the allowed values', async () => {
    const { res, body } = await call(app(), '/enum', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'c' }),
    })
    expect(res.status).toBe(400)
    expect(body.error.details).toEqual([
      { path: 'kind', code: 'enum', message: 'Expected one of: a, b' },
    ])
  })

  test('a title over the maximum is max_length and a missing property is required (once)', async () => {
    const long = (await send({ reason: 'x'.repeat(21), n: 1, lines: [] })).body.error.details as {
      path: string
      code: string
    }[]
    expect(long).toEqual([expect.objectContaining({ path: 'reason', code: 'max_length' })])
    const missing = (await send({ n: 1, lines: [] })).body.error.details as {
      path: string
      code: string
    }[]
    expect(missing).toEqual([expect.objectContaining({ path: 'reason', code: 'required' })])
  })

  test('a body that is not JSON is 400 malformed_request', async () => {
    const { res, body } = await call(app(), '/body', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
    expect(body.error.code).toBe('malformed_request')
  })

  test('an unknown route is 404 not_found in the same shape', async () => {
    const { res, body } = await call(app(), '/nowhere')
    expect(res.status).toBe(404)
    expect(body.error.code).toBe('not_found')
  })
})

describe('DomainError subclasses', () => {
  test('a plain DomainError keeps its code and its kind', async () => {
    THROWN.custom = () => new DomainError('custom_code', 'm', 'conflict')
    const { res, body } = await call(app(), '/throw/custom')
    expect(res.status).toBe(409)
    expect(body.error.code).toBe('custom_code')
  })
})
