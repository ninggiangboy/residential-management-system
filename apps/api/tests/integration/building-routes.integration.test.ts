import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { containerFor } from './support'

/**
 * The routes of `building` over HTTP (DOC-51 E-36, E-37, E-47…E-50, E-52, E-53): the staff guard in front of each, the headers
 * (`ETag`, `If-Match`, `Location`) and the answers the use cases already prove in `modules/building/test` (BD-, FS-).
 */

const BUILDING = '018f0000-0000-7000-8000-000000000001'
const PASSWORD = 'Sunrise2026!'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

let db: TestDb
let app: ReturnType<typeof containerFor>['app']
let close: () => Promise<void>
let admin: string
let manager: string
let technician: string

const call = (path: string, init: RequestInit & { token?: string; json?: unknown } = {}) => {
  const { token, json, headers, ...rest } = init
  return app.handle(
    new Request(`http://localhost/api/v1${path}`, {
      ...rest,
      headers: {
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    }),
  )
}

const errorCode = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code

async function signIn(email: string): Promise<string> {
  const res = await call('/auth/staff/login', {
    method: 'POST',
    json: { email, password: PASSWORD, client: 'app' },
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { accessToken: string }).accessToken
}

beforeAll(async () => {
  db = await cloneTemplate('empty')
  await db.sql`
    INSERT INTO building.building (id, code, name, company, address, hotline, is_demo)
    VALUES (${BUILDING}, 'SUNRISE-A', '{"vi":"Chung cư Sunrise A","en":"Sunrise A Apartments"}',
            '{"name":{"vi":"Công ty Sunrise"},"taxCode":"0312345678"}', '12 Nguyễn Huệ', '1900 1234', false)`
  await db.sql`INSERT INTO building.building_setting (building_id) VALUES (${BUILDING})`
  const hash = await Bun.password.hash(PASSWORD, {
    algorithm: 'argon2id',
    memoryCost: 256,
    timeCost: 1,
  })
  const staff: ReadonlyArray<readonly [string, string, string]> = [
    ['admin@sunrise.example', 'admin', 'Phạm Thu Hà'],
    ['manager@sunrise.example', 'manager', 'Lê Văn Quản'],
    ['tech@sunrise.example', 'technician', 'Trần Kỹ Thuật'],
  ]
  for (const [email, role, name] of staff) {
    await db.sql`
      INSERT INTO identity.staff_account (id, building_id, email, full_name, role, status, password_hash, language)
      VALUES (gen_random_uuid(), ${BUILDING}, ${email}, ${name}, ${role}, 'active', ${hash}, 'en')`
  }
  const built = containerFor(db.url)
  app = built.app
  close = () => built.container.close()
  admin = await signIn('admin@sunrise.example')
  manager = await signIn('manager@sunrise.example')
  technician = await signIn('tech@sunrise.example')
})
afterAll(async () => {
  await close()
  await db.drop()
})

describe('guards', () => {
  test('no token is 401, a Manager is 403 on every Admin route', async () => {
    for (const [method, path] of [
      ['GET', '/staff/settings'],
      ['PATCH', '/staff/settings'],
      ['GET', '/staff/gateway'],
      ['PUT', '/staff/gateway'],
      ['GET', '/staff/terms'],
      ['POST', '/staff/terms'],
    ] as const) {
      expect((await call(path, { method })).status).toBe(401)
      expect((await call(path, { method, token: manager, json: {} })).status).toBe(403)
    }
  })
})

describe('settings (E-47, E-48)', () => {
  test('GET carries the composite ETag and answers 304 to If-None-Match', async () => {
    const res = await call('/staff/settings', { token: admin })
    expect(res.status).toBe(200)
    const etag = res.headers.get('etag')
    expect(etag).toMatch(/^"\d+\.\d+"$/)
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
    const body = (await res.json()) as { building: { id: string }; etag?: string }
    expect(body.building.id).toBe(BUILDING)
    expect(body.etag).toBeUndefined()
    const again = await call('/staff/settings', {
      token: admin,
      headers: { 'if-none-match': etag as string },
    })
    expect(again.status).toBe(304)
  })

  test('PATCH needs If-Match (428), applies once (200, new ETag) and refuses a stale one (409)', async () => {
    const patch = { settings: { defaultDueDays: 15 } }
    const missing = await call('/staff/settings', { method: 'PATCH', token: admin, json: patch })
    expect(missing.status).toBe(428)

    const before = (await call('/staff/settings', { token: admin })).headers.get('etag') as string
    const ok = await call('/staff/settings', {
      method: 'PATCH',
      token: admin,
      headers: { 'if-match': before },
      json: patch,
    })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('etag')).not.toBe(before)
    const body = (await ok.json()) as { settings: { defaultDueDays: number }; saved: string[] }
    expect(body.settings.defaultDueDays).toBe(15)
    expect(body.saved).toContain('defaultDueDays')

    const stale = await call('/staff/settings', {
      method: 'PATCH',
      token: admin,
      headers: { 'if-match': before },
      json: { settings: { defaultDueDays: 20 } },
    })
    expect(stale.status).toBe(409)
    expect(await errorCode(stale)).toBe('version_conflict')
  })

  test('an unknown key is 400, an empty body is 400 and a value out of range is 422', async () => {
    const etag = (await call('/staff/settings', { token: admin })).headers.get('etag') as string
    const patch = (json: unknown) =>
      call('/staff/settings', {
        method: 'PATCH',
        token: admin,
        headers: { 'if-match': etag },
        json,
      })
    expect((await patch({ building: { code: 'X' } })).status).toBe(400)
    expect((await patch({})).status).toBe(400)
    expect((await patch({ settings: { defaultDueDays: 99 } })).status).toBe(422)
  })
})

describe('gateway (E-49, E-50)', () => {
  const account = {
    bankBin: '970436',
    accountNumber: '0011001234567',
    accountName: 'CONG TY SUNRISE',
  }

  test('GET with no configuration lists the drivers and no config, never cached', async () => {
    const res = await call('/staff/gateway', { token: admin })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as {
      configs: unknown[]
      drivers: Record<string, { allowed: boolean }>
    }
    expect(body.configs).toEqual([])
    expect(body.drivers.payos?.allowed).toBe(true)
  })

  test('PUT without a step-up proof is 403 step_up_required', async () => {
    const res = await call('/staff/gateway', {
      method: 'PUT',
      token: admin,
      json: {
        provider: 'payos',
        driver: 'payos',
        receivingAccount: account,
        secrets: { clientId: 'a', apiKey: 'b', checksumKey: 'c' },
      },
    })
    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('step_up_required')
  })

  test('a PUT with a malformed account is 400 before the step-up is asked', async () => {
    const res = await call('/staff/gateway', {
      method: 'PUT',
      token: admin,
      json: {
        provider: 'payos',
        driver: 'payos',
        receivingAccount: { ...account, bankBin: '12' },
        stepUp: { password: PASSWORD, code: '000000' },
      },
    })
    expect(res.status).toBe(400)
  })
})

describe('terms (E-52, E-53)', () => {
  test('publish is 201 with Location and the publisher name; the listing shows it with 0 acceptances', async () => {
    const res = await call('/staff/terms', {
      method: 'POST',
      token: admin,
      json: {
        kind: 'terms',
        text: {
          vi: '## 1. Phạm vi\nHệ thống do Công ty vận hành.',
          en: '## 1. Scope\nRun by the company.',
        },
      },
    })
    expect(res.status).toBe(201)
    expect(res.headers.get('location')).toBe('/api/v1/staff/terms?kind=terms')
    const created = (await res.json()) as {
      versionId: string
      version: number
      publishedBy: { name: string }
      acceptedCount: number
    }
    expect(created.version).toBe(1)
    expect(created.publishedBy.name).toBe('Phạm Thu Hà')
    expect(created.acceptedCount).toBe(0)

    const list = await call('/staff/terms?kind=terms', { token: admin })
    expect(list.status).toBe(200)
    expect(list.headers.get('cache-control')).toBe('no-store')
    const { items } = (await list.json()) as { items: Array<{ versionId: string }> }
    expect(items.map((item) => item.versionId)).toEqual([created.versionId])
    expect((await call('/staff/terms?kind=other', { token: admin })).status).toBe(400)
  })

  test('HTML in the text is refused', async () => {
    const res = await call('/staff/terms', {
      method: 'POST',
      token: admin,
      json: { kind: 'privacy', text: { vi: '<b>x</b>', en: '<b>x</b>' } },
    })
    expect(res.status).toBe(400)
  })
})

describe('uploads (E-36, E-37)', () => {
  const logo = { purpose: 'logo', mime: 'image/png', size: 1000 }

  test('an Admin registers a logo and gets a presigned PUT; the module comes from the purpose', async () => {
    const res = await call('/staff/uploads', { method: 'POST', token: admin, json: logo })
    expect(res.status).toBe(201)
    const ticket = (await res.json()) as { method: string; headers: Record<string, string> }
    expect(ticket.method).toBe('PUT')
    expect(ticket.headers['Content-Type']).toBe('image/png')
  })

  test('a Technician may not register a logo; an import needs its module named', async () => {
    expect(
      (await call('/staff/uploads', { method: 'POST', token: technician, json: logo })).status,
    ).toBe(403)
    const body = { purpose: 'import', mime: XLSX, size: 1000 }
    expect(
      (await call('/staff/uploads', { method: 'POST', token: manager, json: body })).status,
    ).toBe(400)
    const named = await call('/staff/uploads', {
      method: 'POST',
      token: manager,
      json: { ...body, module: 'residency' },
    })
    expect(named.status).toBe(201)
  })

  test('an unknown purpose and a type that is not allowed are 400', async () => {
    const post = (json: unknown) => call('/staff/uploads', { method: 'POST', token: admin, json })
    expect((await post({ ...logo, purpose: 'cccd' })).status).toBe(400)
    expect((await post({ ...logo, mime: 'image/gif' })).status).toBe(400)
  })

  test('verify of a file that does not exist is 404', async () => {
    const res = await call('/staff/uploads/0192f3c4-9d02-7000-8000-00000000f021/verify', {
      method: 'POST',
      token: admin,
    })
    expect(res.status).toBe(404)
  })
})
