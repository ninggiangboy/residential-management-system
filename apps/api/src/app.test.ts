import { describe, expect, test } from 'bun:test'
import { createLogger } from '@core/telemetry'
import { Elysia, t } from 'elysia'
import { buildApp, buildOpsApp, latencyPlugin } from './app'
import { loadAppConfig } from './bootstrap/config'
import { hostEnv, localEnv } from './bootstrap/config/support'
import { type ContainerOverrides, createContainer } from './bootstrap/container'

/** No database is needed: `ping` is replaced, so the tests state exactly what the database does. */
function setup(
  env = localEnv(),
  overrides: ContainerOverrides = {},
  io?: Parameters<typeof loadAppConfig>[1],
) {
  const lines: Record<string, unknown>[] = []
  const logger = createLogger('debug', {
    service: 'api',
    destination: { write: (chunk: string) => void lines.push(JSON.parse(chunk)) },
  })
  const container = createContainer(
    loadAppConfig({ ...env, DATABASE_URL: 'postgres://rms_app:x@127.0.0.1:1/rms' }, io),
    logger,
    overrides,
  )
  const database = { up: true, hang: false }
  container.database.ping = async () => {
    if (database.hang) await new Promise(() => {})
    if (!database.up) throw new Error('ECONNREFUSED')
  }
  const app = buildApp(container)
  const ops = buildOpsApp(container)
  const get = (path: string, init?: RequestInit) =>
    app.handle(new Request(`http://localhost/api/v1${path}`, init))
  const getOps = (path: string) => ops.handle(new Request(`http://localhost${path}`))
  /** `onAfterResponse` runs after the answer is returned: wait for the request line before reading the log. */
  const settled = () => Bun.sleep(5)
  return { app, container, database, get, getOps, lines, settled }
}

describe('/health/ready (DOC-51 E-02)', () => {
  test('the public path answers ok and names no dependency', async () => {
    const { get } = setup()
    const res = await get('/health/ready')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ status: 'ok', maintenance: false })
  })

  test('the ops path lists the database check with its latency', async () => {
    const { getOps } = setup(localEnv({ APP_ROLES: 'api' }))
    const body = (await (await getOps('/health/ready')).json()) as {
      status: string
      checks: { database: { ok: boolean; latencyMs: number } }
    }
    expect(body.status).toBe('ok')
    expect(body.checks.database.ok).toBe(true)
    expect(body.checks.database.latencyMs).toBeGreaterThanOrEqual(0)
  })

  test('P1-04 it is 503 degraded when the database is down, on both ports, without the error shape', async () => {
    const { get, getOps, database } = setup(localEnv({ APP_ROLES: 'api' }))
    database.up = false
    const publicRes = await get('/health/ready')
    expect(publicRes.status).toBe(503)
    expect(await publicRes.json()).toEqual({ status: 'degraded', maintenance: false })
    const opsRes = await getOps('/health/ready')
    expect(opsRes.status).toBe(503)
    expect(await opsRes.json()).toEqual({
      status: 'degraded',
      maintenance: false,
      checks: { database: { ok: false, latencyMs: expect.any(Number) } },
    })
    expect(opsRes.headers.get('retry-after')).toBeNull()
  })

  test('JB-26 a worker also reports its relay: 503 until the loop has finished a pass, 200 while it runs', async () => {
    const { getOps, container } = setup()
    const before = await getOps('/health/ready')
    expect(before.status).toBe(503)
    expect(((await before.json()) as { checks: { relay: { ok: boolean } } }).checks.relay.ok).toBe(
      false,
    )
    container.runtime.relay.start()
    try {
      let status = 503
      for (let i = 0; i < 40 && status !== 200; i++) {
        status = (await getOps('/health/ready')).status
        if (status !== 200) await Bun.sleep(50)
      }
      expect(status).toBe(200)
    } finally {
      await container.runtime.relay.stop()
    }
  })

  test('ER-14 a database that does not answer within the timeout fails readiness', async () => {
    const { get, database } = setup(localEnv({ READINESS_DB_TIMEOUT_MS: '50' }))
    database.hang = true
    const begin = performance.now()
    expect((await get('/health/ready')).status).toBe(503)
    expect(performance.now() - begin).toBeLessThan(1000)
  })

  test('stopping is 503 stopping from the moment shutdown starts, even with a healthy database', async () => {
    const { get, container } = setup()
    container.lifecycle.stopping = true
    const res = await get('/health/ready')
    expect(res.status).toBe(503)
    expect(((await res.json()) as { status: string }).status).toBe('stopping')
  })

  test('AG-06 maintenance keeps readiness 200 (and says so) while a business route is 503 maintenance', async () => {
    const { app, get, container } = setup(localEnv(), {
      maintenanceStore: {
        read: async () => ({ active: true, reason: 'deploy', since: new Date() }),
      },
    })
    await container.maintenance.refresh()
    const ready = await get('/health/ready')
    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({ status: 'ok', maintenance: true })
    const business = await app.handle(new Request('http://localhost/api/v1/staff/anything'))
    expect(business.status).toBe(503)
    expect(business.headers.get('retry-after')).toBe('30')
    expect(((await business.json()) as { error: { code: string } }).error.code).toBe('maintenance')
  })

  test('/health/live exists on the ops port only', async () => {
    const { get, getOps } = setup()
    expect((await getOps('/health/live')).status).toBe(200)
    expect(await (await getOps('/health/live')).json()).toEqual({ status: 'ok' })
    expect((await get('/health/live')).status).toBe(404)
  })
})

describe('the request id and the request line', () => {
  test('X-Request-Id is on every answer, a valid caller id is kept and the line carries it', async () => {
    const { get, lines, settled } = setup()
    const res = await get('/nowhere', { headers: { 'x-request-id': 'caller-id.1' } })
    await settled()
    expect(res.headers.get('x-request-id')).toBe('caller-id.1')
    const line = lines.find((l) => l.msg === 'request')
    expect(line).toMatchObject({
      requestId: 'caller-id.1',
      method: 'GET',
      status: 404,
      code: 'not_found',
      service: 'api',
    })
  })

  test('ER-29 the line has the route and no query string, no header and no body', async () => {
    const { get, lines, settled } = setup()
    await get('/nowhere?phone=0901234567&q=nguyen', {
      headers: { authorization: 'Bearer abc.def.ghi', cookie: 'x=y' },
    })
    await settled()
    expect(lines.some((l) => l.msg === 'request')).toBe(true)
    const text = JSON.stringify(lines)
    for (const leak of ['0901234567', 'nguyen', 'abc.def.ghi', 'x=y', 'phone='])
      expect(text).not.toContain(leak)
  })

  test('a health probe is logged at debug, a 404 at info, and the address only on the answers that need it', async () => {
    const { get, lines, settled } = setup()
    await get('/health/ready')
    await get('/nowhere')
    await settled()
    const [probe, notFound] = lines.filter((l) => l.msg === 'request')
    expect(probe).toMatchObject({ level: 'debug' })
    expect(notFound).toMatchObject({ level: 'info' })
    expect(notFound?.ip).toBeUndefined()
  })

  test('OB-10 every line written while serving has requestId, service, level, time and msg', async () => {
    const { get, lines, settled } = setup()
    await get('/nowhere')
    await get('/health/ready')
    await settled()
    for (const line of lines) {
      expect(line).toMatchObject({ service: 'api' })
      for (const field of ['requestId', 'level', 'time', 'msg']) expect(line[field]).toBeDefined()
    }
  })
})

describe('OpenAPI and CORS', () => {
  test('AG-03 the OpenAPI document is served in local and answers 404 in production', async () => {
    expect((await setup().get('/openapi.json')).status).toBe(200)
    const { env, io } = hostEnv('production')
    expect((await setup(env, {}, io).get('/openapi.json')).status).toBe(404)
  })

  test('AG-25 a preflight from the allowed origin lists the headers; another origin gets no CORS headers', async () => {
    const { get } = setup()
    const preflight = (origin: string) =>
      get('/anything', {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,idempotency-key',
        },
      })
    const allowed = await preflight('http://localhost:5173')
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(allowed.headers.get('access-control-allow-credentials')).toBe('true')
    expect(allowed.headers.get('access-control-allow-headers')).toContain('Idempotency-Key')
    expect(allowed.headers.get('access-control-max-age')).toBe('600')
    const evil = await preflight('https://evil.example')
    expect(evil.headers.get('access-control-allow-origin')).toBeNull()
    expect(evil.headers.get('access-control-allow-credentials')).toBeNull()
  })
})

describe('the order of the gates (DOC-50 §7, AG-04)', () => {
  const body = t.Object({ reason: t.String({ minLength: 5 }) }, { additionalProperties: false })
  const invalid = () => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'x' }),
  })

  test('Elysia validates a body before beforeHandle and resolve, but after onTransform: a guard installed there answers first', async () => {
    const order: string[] = []
    const probe = new Elysia({ normalize: false })
      .onError(({ code }) => {
        order.push(`error:${code}`)
        return ''
      })
      .post('/before', () => 'ok', { body, beforeHandle: () => void order.push('beforeHandle') })
      .post('/transform', () => 'ok', { body, transform: () => void order.push('transform') })
    await probe.handle(new Request('http://localhost/before', invalid()))
    await probe.handle(new Request('http://localhost/transform', invalid()))
    // beforeHandle never ran for the invalid body; transform did, and ran before the validation error.
    expect(order).toEqual(['error:VALIDATION', 'transform', 'error:VALIDATION'])
  })
})

describe('latencyPlugin', () => {
  const timed = async (appEnv: string, path: string) => {
    const app = new Elysia().use(latencyPlugin(appEnv, 200)).get('/*', () => 'ok')
    const started = performance.now()
    await app.handle(new Request(`http://localhost${path}`))
    return performance.now() - started
  }

  test('CF-20 only local waits, at least half the configured delay, and never on a health route (DR-305)', async () => {
    expect(await timed('local', '/api/v1/staff/me')).toBeGreaterThanOrEqual(95)
    expect(await timed('test', '/api/v1/staff/me')).toBeLessThan(50)
    expect(await timed('local', '/api/v1/health/ready')).toBeLessThan(50)
  })
})
