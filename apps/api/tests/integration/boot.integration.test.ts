import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { containerFor, freePort, startMain } from './support'

let db: TestDb
beforeAll(async () => {
  db = await cloneTemplate('empty')
})
afterAll(async () => {
  await db.drop()
})

describe('readiness against a real PostgreSQL (P1-04)', () => {
  test('/health/ready is 200 with the database up and 503 degraded once it is gone', async () => {
    const { container, app, ops } = containerFor(db.url)
    const ready = () => app.handle(new Request('http://localhost/api/v1/health/ready'))
    const opsReady = () => ops.handle(new Request('http://localhost/health/ready'))

    const up = await ready()
    expect(up.status).toBe(200)
    expect(await up.json()).toEqual({ status: 'ok', maintenance: false })
    const detail = (await (await opsReady()).json()) as { checks: { database: { ok: boolean } } }
    expect(detail.checks.database.ok).toBe(true)

    // The pool is closed: every query now fails, as it does when the server is gone.
    await container.database.close()
    const down = await ready()
    expect(down.status).toBe(503)
    expect(await down.json()).toEqual({ status: 'degraded', maintenance: false })
    expect((await opsReady()).status).toBe(503)
  })

  test('the connection of the application is rms_app, which cannot create a table', async () => {
    const rows = await db.sql<{ user: string }[]>`SELECT current_user AS user`
    expect(rows[0]?.user).toBe('rms_app')
    const refused = await db.sql`CREATE TABLE public.nope (id int)`.then(
      () => 'created',
      (error: { code?: string }) => error.code,
    )
    expect(refused).toBe('42501')
  })

  test('the maintenance flag reads as off when its table does not exist yet, and a real flag turns the gate on', async () => {
    const { container, app } = containerFor(db.url)
    await container.maintenance.refresh()
    expect(container.maintenance.active).toBe(false)
    const admin = db.admin()
    try {
      await admin`CREATE SCHEMA IF NOT EXISTS platform`
      await admin`CREATE TABLE IF NOT EXISTS platform.maintenance (id boolean PRIMARY KEY DEFAULT true CHECK (id), active boolean NOT NULL DEFAULT false, reason text, since timestamptz)`
      await admin`GRANT USAGE ON SCHEMA platform TO rms_app`
      await admin`GRANT SELECT ON platform.maintenance TO rms_app`
      await admin`INSERT INTO platform.maintenance (id, active, reason, since) VALUES (true, true, 'test', now()) ON CONFLICT (id) DO UPDATE SET active = true`
      await container.maintenance.refresh()
      expect(container.maintenance.active).toBe(true)
      const business = await app.handle(new Request('http://localhost/api/v1/staff/x'))
      expect(business.status).toBe(503)
      expect(((await business.json()) as { error: { code: string } }).error.code).toBe(
        'maintenance',
      )
      const ready = await app.handle(new Request('http://localhost/api/v1/health/ready'))
      expect(ready.status).toBe(200)
    } finally {
      await admin`DROP SCHEMA platform CASCADE`
      await admin.end()
      await container.close()
    }
  })
})

describe('the process (`bun src/main.ts`)', () => {
  test('boots against the database, serves both ports and exits 0 on SIGTERM', async () => {
    const [port, opsPort] = [freePort(), freePort()]
    const main = startMain({
      DATABASE_URL: db.url,
      PORT: String(port),
      OPS_PORT: String(opsPort),
      LOG_LEVEL: 'info',
    })
    try {
      expect(await main.waitReady(opsPort)).toBe(200)
      const publicReady = await fetch(`http://127.0.0.1:${port}/api/v1/health/ready`)
      expect(publicReady.status).toBe(200)
    } finally {
      main.proc.kill('SIGTERM')
    }
    expect(await main.proc.exited).toBe(0)
    const lines = (await main.output())
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { msg: string })
    expect(lines.map((line) => line.msg)).toEqual(
      expect.arrayContaining(['ops_listening', 'api_listening', 'shutting_down']),
    )
  })

  test('DR-272 SIGTERM during a request: readiness is 503 first, the request in flight is answered in full, then the process exits 0', async () => {
    const [port, opsPort] = [freePort(), freePort()]
    const main = startMain({
      DATABASE_URL: db.url,
      PORT: String(port),
      OPS_PORT: String(opsPort),
      SHUTDOWN_DRAIN_SECONDS: '1',
      LOG_LEVEL: 'info',
    })
    expect(await main.waitReady(opsPort)).toBe(200)

    // A request whose body is still on its way: the server has the connection open and is waiting for the rest.
    const body = JSON.stringify({ email: 'nobody@example.com', password: 'not-a-password-1' })
    let answer = ''
    let closed!: () => void
    const done = new Promise<void>((resolve) => {
      closed = resolve
    })
    const socket = await Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        data: (_socket, data) => {
          answer += new TextDecoder().decode(data)
        },
        close: () => closed(),
        error: () => closed(),
      },
    })
    socket.write(
      `POST /api/v1/auth/staff/login HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body.slice(0, 10)}`,
    )
    await Bun.sleep(200)

    main.proc.kill('SIGTERM')
    // During the drain the port is open and readiness says `stopping`.
    await Bun.sleep(300)
    expect(await main.readyStatus(opsPort)).toBe(503)
    expect(main.proc.exitCode).toBeNull()
    // The drain (1 s) is over and the listener is closed; the process still waits for the request.
    await Bun.sleep(1500)
    expect(main.proc.exitCode, `answered early: ${answer.slice(0, 200)}`).toBeNull()
    socket.write(body.slice(10))
    await done

    expect(answer).toMatch(/^HTTP\/1\.1 \d{3} /)
    expect(await main.proc.exited).toBe(0)
  })

  test('DR-161 with no database it answers 503 on the ops port for 30 s, then exits 1 (not 78)', async () => {
    const [port, opsPort] = [freePort(), freePort()]
    const dead = `postgres://rms_app:x@127.0.0.1:${freePort()}/rms`
    const main = startMain({
      DATABASE_URL: dead,
      PORT: String(port),
      OPS_PORT: String(opsPort),
      LOG_LEVEL: 'info',
    })
    const begin = performance.now()
    let during: number | undefined
    for (let i = 0; i < 30 && during === undefined; i++) {
      during = await main.readyStatus(opsPort)
      if (during === undefined) await Bun.sleep(100)
    }
    expect(during).toBe(503)
    // The public port is not open yet: nothing is served before the database answers.
    await expect(fetch(`http://127.0.0.1:${port}/api/v1/health/ready`)).rejects.toThrow()
    const code = await main.proc.exited
    const seconds = (performance.now() - begin) / 1000
    expect(code).toBe(1)
    expect(seconds).toBeGreaterThanOrEqual(29)
    expect(seconds).toBeLessThan(40)
    const lines = (await main.output())
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { msg: string; level: string })
    expect(lines.at(-1)).toMatchObject({ msg: 'database_unreachable', level: 'fatal' })
    expect(lines.filter((line) => line.msg === 'database_wait').length).toBeGreaterThanOrEqual(10)
  }, 45_000)
})
