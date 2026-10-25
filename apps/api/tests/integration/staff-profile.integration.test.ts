import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { FakeStorage } from '@core/testing'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import sharp from 'sharp'
import { containerFor } from './support'

/**
 * The profile of the signed-in staff member and the public configuration over HTTP (DOC-51 E-03, E-30, E-31): the `ETag` and
 * `If-Match` of the profile, the avatar that is verified, attached and replaced with the update, and the contact block that a
 * client reads before anyone signs in. What `FilesApi` does with the file is proved in `modules/building/test` (FS-).
 */

const BUILDING = '018f0000-0000-7000-8000-000000000001'
const PASSWORD = 'Sunrise2026!'

let db: TestDb
let app: ReturnType<typeof containerFor>['app']
let close: () => Promise<void>
const storage = new FakeStorage()
let manager: string
let guard: string

const call = (
  path: string,
  init: RequestInit & { token?: string; json?: unknown; key?: string | null } = {},
) => {
  const { token, json, headers, key, ...rest } = init
  return app.handle(
    new Request(`http://localhost/api/v1${path}`, {
      ...rest,
      headers: {
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(rest.method === 'POST' && key !== null
          ? { 'idempotency-key': key ?? crypto.randomUUID() }
          : {}),
        ...headers,
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    }),
  )
}

const bodyOf = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T
const errorOf = async (res: Response) =>
  (await bodyOf<{ error: { code: string; details?: unknown } }>(res)).error

async function signIn(email: string): Promise<string> {
  const res = await call('/auth/staff/login', {
    method: 'POST',
    json: { email, password: PASSWORD, client: 'web' },
  })
  expect(res.status).toBe(200)
  return (await bodyOf<{ accessToken: string }>(res)).accessToken
}

/** E-36, the `PUT` to the bucket, E-37: what the browser does before it saves the profile. */
async function uploadAvatar(token: string, purpose = 'avatar'): Promise<string> {
  const body = new Uint8Array(
    await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 34, g: 170, b: 119 } },
    })
      .png()
      .toBuffer(),
  )
  const registered = await call('/staff/uploads', {
    method: 'POST',
    token,
    json: { purpose, module: 'identity', mime: 'image/png', size: body.byteLength },
  })
  expect(registered.status).toBe(201)
  const ticket = await bodyOf<{ fileId: string; url: string }>(registered)
  await storage.write(new URL(ticket.url).pathname.replace(/^\/put\//, ''), body, 'image/png')
  const verified = await call(`/staff/uploads/${ticket.fileId}/verify`, { method: 'POST', token })
  expect(verified.status).toBe(200)
  return ticket.fileId
}

const me = async (token: string) => {
  const res = await call('/staff/me', { token })
  return { res, body: await bodyOf<Record<string, unknown>>(res) }
}
const patch = (token: string, version: number | string | null, json: unknown) =>
  call('/staff/me', {
    method: 'PATCH',
    token,
    json,
    headers: version === null ? {} : { 'if-match': `"${version}"` },
  })

beforeAll(async () => {
  db = await cloneTemplate('empty')
  await db.sql`
    INSERT INTO building.building (id, code, name, company, address, hotline, working_hours, email, is_demo)
    VALUES (${BUILDING}, 'SUNRISE-A', '{"vi":"Chung cư Sunrise A","en":"Sunrise A Apartments"}',
            '{"name":{"vi":"Công ty Sunrise"},"taxCode":"0312345678"}', '12 Nguyễn Huệ', '1900 1234',
            '{"vi":"Thứ 2 – Thứ 6, 8:00 – 17:00"}', 'bql@sunrise.example', false)`
  await db.sql`INSERT INTO building.building_setting (building_id) VALUES (${BUILDING})`
  const hash = await Bun.password.hash(PASSWORD, {
    algorithm: 'argon2id',
    memoryCost: 256,
    timeCost: 1,
  })
  for (const [email, role, name] of [
    ['manager@sunrise.example', 'manager', 'Lê Văn Quản'],
    ['guard@sunrise.example', 'guard', 'Võ Bảo Vệ'],
  ] as const)
    await db.sql`
      INSERT INTO identity.staff_account (id, building_id, email, full_name, role, status, password_hash, language)
      VALUES (gen_random_uuid(), ${BUILDING}, ${email}, ${name}, ${role}, 'active', ${hash}, 'vi')`
  const built = containerFor(db.url, { storage })
  app = built.app
  close = () => built.container.close()
  manager = await signIn('manager@sunrise.example')
  guard = await signIn('guard@sunrise.example')
})
afterAll(async () => {
  await close()
  await db.drop()
})

describe('E-03 GET /public/config', () => {
  test('answers without a credential, with the contact block and the release block, cacheable for a minute', async () => {
    const res = await call('/public/config')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    const body = await bodyOf<Record<string, any>>(res)
    expect(body).toMatchObject({
      languages: ['vi', 'en'],
      defaultLanguage: 'vi',
      contact: {
        name: { vi: 'Chung cư Sunrise A', en: 'Sunrise A Apartments' },
        hotline: '1900 1234',
        workingHours: { vi: 'Thứ 2 – Thứ 6, 8:00 – 17:00', en: null },
        email: 'bql@sunrise.example',
      },
    })
    expect(body.apps.staff.minVersion).toMatch(/^\d+\.\d+\.\d+$/)
    expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false)
  })

  test('holds no address, no company line and no tax code', async () => {
    const text = await (await call('/public/config')).text()
    expect(text).not.toContain('Nguyễn Huệ')
    expect(text).not.toContain('0312345678')
    expect(text).not.toContain('Công ty Sunrise')
  })
})

describe('E-30 GET /staff/me', () => {
  test('is 401 without a token and carries the shape, the ETag and a 304 for If-None-Match', async () => {
    expect((await call('/staff/me')).status).toBe(401)
    const { res, body } = await me(manager)
    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      email: 'manager@sunrise.example',
      fullName: 'Lê Văn Quản',
      role: 'manager',
      status: 'active',
      buildingId: BUILDING,
      language: 'vi',
      pushEnabled: true,
      avatarUrl: null,
      version: 1,
    })
    expect(body).not.toHaveProperty('passwordHash')
    expect(res.headers.get('etag')).toBe('"1"')
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
    const again = await call('/staff/me', { token: manager, headers: { 'if-none-match': '"1"' } })
    expect(again.status).toBe(304)
  })
})

describe('E-31 PATCH /staff/me', () => {
  test('changes the name and the language, bumps the version and answers the new object', async () => {
    const res = await patch(manager, 1, { fullName: '  Lê Văn Quản Lý  ', language: 'en' })
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBe('"2"')
    expect(await bodyOf(res)).toMatchObject({
      fullName: 'Lê Văn Quản Lý',
      language: 'en',
      version: 2,
    })
    expect((await me(manager)).body).toMatchObject({ language: 'en', version: 2 })
  })

  test('refuses a missing If-Match (428), a stale one (409) and an unknown key (400)', async () => {
    expect((await patch(manager, null, { language: 'vi' })).status).toBe(428)
    const stale = await patch(manager, 1, { language: 'vi' })
    expect(stale.status).toBe(409)
    expect((await errorOf(stale)).code).toBe('version_conflict')
    for (const json of [{ email: 'x@y.example' }, { role: 'admin' }, { status: 'locked' }, {}])
      expect((await patch(manager, 2, json)).status).toBe(400)
    expect((await patch(manager, 2, { fullName: '   ' })).status).toBe(400)
    expect((await patch(manager, 2, { fullName: 'x'.repeat(121) })).status).toBe(400)
    expect((await patch(manager, 2, { language: 'fr' })).status).toBe(400)
  })

  test('a change that changes nothing leaves the version alone', async () => {
    const res = await patch(manager, 2, { language: 'en' })
    expect(res.status).toBe(200)
    expect(await bodyOf(res)).toMatchObject({ version: 2 })
  })

  test('every role edits only its own row, and the audit row names the self edit without the name', async () => {
    const res = await patch(guard, 1, { pushEnabled: false })
    expect(res.status).toBe(200)
    expect((await me(guard)).body).toMatchObject({ pushEnabled: false })
    expect((await me(manager)).body).toMatchObject({ pushEnabled: true })
    const [row] = await db.sql`
      SELECT details, changes FROM audit.audit_log WHERE action = 'identity.staff.update' ORDER BY at DESC LIMIT 1`
    expect(row?.details).toMatchObject({ self: true })
    expect(JSON.stringify(row?.changes)).toContain('pushEnabled')
  })

  test('the avatar is attached with the update, signed in the answer, replaced and removed', async () => {
    const first = await uploadAvatar(manager)
    const set = await patch(manager, 2, { avatarFileId: first })
    expect(set.status).toBe(200)
    const body = await bodyOf<{ avatarUrl: string; version: number }>(set)
    expect(body.avatarUrl).toStartWith('http')
    const [attached] =
      await db.sql`SELECT status, owner_ref FROM building.file_object WHERE id = ${first}`
    expect(attached).toMatchObject({ status: 'attached' })

    const second = await uploadAvatar(manager)
    const swapped = await patch(manager, body.version, { avatarFileId: second })
    expect(swapped.status).toBe(200)
    const [old] = await db.sql`SELECT status FROM building.file_object WHERE id = ${first}`
    expect(old).toMatchObject({ status: 'deleted' })

    const cleared = await patch(manager, body.version + 1, { avatarFileId: null })
    expect(cleared.status).toBe(200)
    expect(await bodyOf(cleared)).toMatchObject({ avatarUrl: null })
    const [gone] = await db.sql`SELECT status FROM building.file_object WHERE id = ${second}`
    expect(gone).toMatchObject({ status: 'deleted' })
  })

  test("an unknown file and another account's file are refused and change nothing", async () => {
    const version = (await me(manager)).body.version as number
    const others = await uploadAvatar(guard)
    for (const fileId of [others, crypto.randomUUID()]) {
      const res = await patch(manager, version, { avatarFileId: fileId })
      expect([404, 422]).toContain(res.status)
    }
    expect((await me(manager)).body.version).toBe(version)
    const [row] = await db.sql`SELECT status FROM building.file_object WHERE id = ${others}`
    expect(row).toMatchObject({ status: 'verified' })
  })

  test('a stale If-Match leaves the file unattached', async () => {
    const fileId = await uploadAvatar(manager)
    const res = await patch(manager, 1, { avatarFileId: fileId })
    expect(res.status).toBe(409)
    const [row] = await db.sql`SELECT status FROM building.file_object WHERE id = ${fileId}`
    expect(row).toMatchObject({ status: 'verified' })
  })
})
