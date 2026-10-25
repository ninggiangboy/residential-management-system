import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { errorHandlerPlugin, requestContextPlugin, routePlugin, unitRoute } from '@core/http'
import { createLogger } from '@core/telemetry'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { containerFor } from './support'

/**
 * The staff routes of `residency` over HTTP against a real PostgreSQL (DOC-51 E-57…E-67, E-69): the guard in front of each, the
 * `Idempotency-Key` of the two creates, `ETag` and `If-Match`, the cursors, the building scope, and the flows whose proof is another
 * module's side: a transfer ends the old owner's access on their next request (RM-23), a phone change ends every session of the
 * account (RM-31). The rules are proved against PostgreSQL in `modules/residency/test`.
 */

const BUILDING = '018f0000-0000-7000-8000-000000000001'
const OTHER_BUILDING = '018f0000-0000-7000-8000-000000000002'
const PASSWORD = 'Sunrise2026!'

let db: TestDb
let built: ReturnType<typeof containerFor>
let probe: { handle(request: Request): Promise<Response> | Response }
let manager: string
let admin: string
let technician: string
let guard: string
let strangerManager: string
let phoneCounter = 0

const call = (
  path: string,
  init: RequestInit & { token?: string; json?: unknown; key?: string | null } = {},
) => {
  const { token, json, headers, key, ...rest } = init
  return built.app.handle(
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

async function signInStaff(email: string): Promise<string> {
  const res = await call('/auth/staff/login', {
    method: 'POST',
    json: { email, password: PASSWORD, client: 'app' },
  })
  expect(res.status).toBe(200)
  return (await bodyOf<{ accessToken: string }>(res)).accessToken
}

/** A demo account signs in with the fixed code, which is the way to a real resident token without an SMS. */
async function signInResident(phone: string) {
  const requested = await call('/auth/otp', { method: 'POST', json: { phone } })
  const { challengeId } = await bodyOf<{ challengeId: string }>(requested)
  const verified = await call('/auth/otp/verify', {
    method: 'POST',
    json: { challengeId, code: '123456' },
  })
  expect(verified.status).toBe(200)
  return { token: (await bodyOf<{ accessToken: string }>(verified)).accessToken }
}

async function seedResident(unitId: string, memberType: 'owner' | 'family' | 'tenant' | 'helper') {
  phoneCounter++
  const phone = `+84903${String(phoneCounter).padStart(6, '0')}`
  const id = crypto.randomUUID()
  await db.sql`
    INSERT INTO identity.resident_account (id, phone, display_name, is_demo)
    VALUES (${id}, ${phone}, ${`Resident ${phoneCounter}`}, true)`
  await db.sql`
    INSERT INTO residency.resident_profile (building_id, account_id, full_name)
    VALUES (${BUILDING}, ${id}, ${`Resident ${phoneCounter}`})`
  const membershipId = crypto.randomUUID()
  await db.sql`
    INSERT INTO residency.membership (id, building_id, account_id, unit_id, member_type, added_by_kind, added_by)
    VALUES (${membershipId}, ${BUILDING}, ${id}, ${unitId}, ${memberType}, 'staff', ${crypto.randomUUID()})`
  return { id, phone, membershipId, ...(await signInResident(phone)) }
}

const createUnit = async (code: string, json: object = {}, token = manager) => {
  const res = await call('/staff/units', { method: 'POST', token, json: { code, ...json } })
  expect(res.status).toBe(201)
  return bodyOf<{ unitId: string; code: string; version: number }>(res)
}

const asUnit = (path: string, token: string, unitId: string) =>
  probe.handle(
    new Request(`http://localhost/api/v1${path}`, {
      headers: { authorization: `Bearer ${token}`, 'x-unit-id': unitId },
    }),
  )

beforeAll(async () => {
  db = await cloneTemplate('empty')
  for (const [id, code] of [
    [BUILDING, 'SUNRISE-A'],
    [OTHER_BUILDING, 'SUNRISE-B'],
  ] as const) {
    await db.sql`
      INSERT INTO building.building (id, code, name, company, address, hotline, is_demo)
      VALUES (${id}, ${code}, '{"vi":"Chung cư","en":"Apartments"}',
              '{"name":{"vi":"Công ty"},"taxCode":"0312345678"}', '12 Nguyễn Huệ', '1900 1234', ${id === BUILDING ? false : false})`
    await db.sql`INSERT INTO building.building_setting (building_id) VALUES (${id})`
  }
  const hash = await Bun.password.hash(PASSWORD, {
    algorithm: 'argon2id',
    memoryCost: 256,
    timeCost: 1,
  })
  for (const [email, role, name, building] of [
    ['admin@sunrise.example', 'admin', 'Phạm Thu Hà', BUILDING],
    ['manager@sunrise.example', 'manager', 'Lê Văn Quản', BUILDING],
    ['tech@sunrise.example', 'technician', 'Trần Kỹ Thuật', BUILDING],
    ['guard@sunrise.example', 'guard', 'Võ Bảo Vệ', BUILDING],
    ['manager@other.example', 'manager', 'Quản Lý B', OTHER_BUILDING],
  ] as const)
    await db.sql`
      INSERT INTO identity.staff_account (id, building_id, email, full_name, role, status, password_hash, language)
      VALUES (gen_random_uuid(), ${building}, ${email}, ${name}, ${role}, 'active', ${hash}, 'en')`
  built = containerFor(db.url, {}, { OTP_PER_IP_PER_HOUR: '1000', TRUSTED_PROXY_HOPS: '0' })
  probe = routePlugin({ prefix: '/api/v1' })
    .use(requestContextPlugin)
    .use(errorHandlerPlugin({ logger: createLogger('silent') }))
    .get(
      '/me/notices',
      () => ({ ok: true }),
      unitRoute(built.container.guards, 'test', 'broadcast_notices', {
        endpoint: 'T-01',
        operationId: 'probeNotices',
      }),
    )
  admin = await signInStaff('admin@sunrise.example')
  manager = await signInStaff('manager@sunrise.example')
  technician = await signInStaff('tech@sunrise.example')
  guard = await signInStaff('guard@sunrise.example')
  strangerManager = await signInStaff('manager@other.example')
})
afterAll(async () => {
  await built.container.close()
  await db.drop()
})

describe('the guard of every route', () => {
  test('no token is 401; a Technician and a Guard are 403', async () => {
    const id = '0192f3c4-c001-7000-8000-000000000b01'
    for (const [method, path] of [
      ['GET', '/staff/units'],
      ['POST', '/staff/units'],
      ['GET', `/staff/units/${id}`],
      ['PATCH', `/staff/units/${id}`],
      ['POST', `/staff/units/${id}/owner`],
      ['GET', `/staff/units/${id}/history`],
      ['GET', '/staff/residents'],
      ['POST', '/staff/residents'],
      ['GET', `/staff/residents/${id}`],
      ['PATCH', `/staff/residents/${id}`],
      ['PATCH', `/staff/residents/${id}/phone`],
      ['POST', `/staff/residents/${id}/deletion/approve`],
      ['PATCH', `/staff/memberships/${id}`],
    ] as const) {
      expect((await call(path, { method })).status).toBe(401)
      for (const token of [technician, guard])
        expect((await call(path, { method, token, json: {} })).status).toBe(403)
    }
  })

  test('an Admin passes where a Manager does', async () => {
    expect((await call('/staff/units', { token: admin })).status).toBe(200)
    expect((await call('/staff/residents', { token: admin })).status).toBe(200)
  })
})

describe('units (E-57…E-62)', () => {
  test('E-58 creates under an Idempotency-Key: 201 with Location and ETag, the same key replays, another body is 422', async () => {
    const key = crypto.randomUUID()
    const first = await call('/staff/units', {
      method: 'POST',
      token: manager,
      key,
      json: { code: 'a-1509', floor: 15, areaM2: '82.00' },
    })
    expect(first.status).toBe(201)
    const unit = await bodyOf<{ unitId: string; code: string; version: number }>(first)
    expect(unit).toMatchObject({
      code: 'A-1509',
      floor: 15,
      areaM2: '82.00',
      occupancy: 'vacant',
      version: 1,
    })
    expect(first.headers.get('location')).toBe(`/api/v1/staff/units/${unit.unitId}`)
    expect(first.headers.get('etag')).toBe('"1"')
    const replay = await call('/staff/units', {
      method: 'POST',
      token: manager,
      key,
      json: { code: 'a-1509', floor: 15, areaM2: '82.00' },
    })
    expect(replay.status).toBe(201)
    expect(replay.headers.get('idempotent-replayed')).toBe('true')
    expect((await bodyOf<{ unitId: string }>(replay)).unitId).toBe(unit.unitId)
    const reuse = await call('/staff/units', {
      method: 'POST',
      token: manager,
      key,
      json: { code: 'A-9' },
    })
    expect(reuse.status).toBe(422)
    expect((await errorOf(reuse)).code).toBe('idempotency_key_reuse')
    const rows = await db.sql`SELECT 1 FROM residency.unit WHERE code = 'A-1509'`
    expect(rows).toHaveLength(1)
  })

  test('E-58 refuses a bad code, an unknown key and a duplicate code', async () => {
    const bad = await call('/staff/units', { method: 'POST', token: manager, json: { code: '-x' } })
    expect(bad.status).toBe(400)
    expect(JSON.stringify((await errorOf(bad)).details)).toContain('pattern')
    const unknown = await call('/staff/units', {
      method: 'POST',
      token: manager,
      json: { code: 'U-1', colour: 1 },
    })
    expect(unknown.status).toBe(400)
    await createUnit('U-2')
    const duplicate = await call('/staff/units', {
      method: 'POST',
      token: manager,
      json: { code: 'u-2' },
    })
    expect(duplicate.status).toBe(409)
    expect((await errorOf(duplicate)).code).toBe('unit_code_in_use')
    expect(
      (
        await call('/staff/units', {
          method: 'POST',
          token: manager,
          json: { code: 'U-3' },
          key: null,
        })
      ).status,
    ).toBe(400)
  })

  test('E-59 returns the detail with an ETag and never answers 304, so a changed household is never stale; another building is 404', async () => {
    const unit = await createUnit('V-1')
    const res = await call(`/staff/units/${unit.unitId}`, { token: manager })
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBe('"1"')
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
    expect(await bodyOf(res)).toMatchObject({
      code: 'V-1',
      owner: null,
      members: [],
      debt: { openChargeCount: 0, openAmount: 0, oldestDueDate: null },
    })
    const cached = await call(`/staff/units/${unit.unitId}`, {
      token: manager,
      headers: { 'if-none-match': '"1"' },
    })
    expect(cached.status).toBe(200)
    expect((await call(`/staff/units/${unit.unitId}`, { token: strangerManager })).status).toBe(404)
    expect((await call(`/staff/units/${crypto.randomUUID()}`, { token: manager })).status).toBe(404)
  })

  test('E-60 edits under If-Match: 428 without it, 409 with the fresh unit when stale, 200 with the new ETag', async () => {
    const unit = await createUnit('V-2', { floor: 2 })
    const path = `/staff/units/${unit.unitId}`
    expect((await call(path, { method: 'PATCH', token: manager, json: { floor: 3 } })).status).toBe(
      428,
    )
    const ok = await call(path, {
      method: 'PATCH',
      token: manager,
      headers: { 'if-match': '"1"' },
      json: { floor: 3, note: null },
    })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('etag')).toBe('"2"')
    expect(await bodyOf(ok)).toMatchObject({ floor: 3, version: 2 })
    const stale = await call(path, {
      method: 'PATCH',
      token: manager,
      headers: { 'if-match': '"1"' },
      json: { floor: 4 },
    })
    expect(stale.status).toBe(409)
    const error = await errorOf(stale)
    expect(error.code).toBe('version_conflict')
    expect(JSON.stringify(error.details)).toContain('"version":2')
    const empty = await call(path, {
      method: 'PATCH',
      token: manager,
      headers: { 'if-match': '"2"' },
      json: {},
    })
    expect(empty.status).toBe(400)
    const outOfRange = await call(path, {
      method: 'PATCH',
      token: manager,
      headers: { 'if-match': '"2"' },
      json: { floor: 999 },
    })
    expect(outOfRange.status).toBe(400)
    expect(
      (
        await call(path, {
          method: 'PATCH',
          token: strangerManager,
          headers: { 'if-match': '"2"' },
          json: { floor: 4 },
        })
      ).status,
    ).toBe(404)
  })

  test('E-57 lists in code order with a summary, pages by cursor, searches by prefix and refuses a bad cursor', async () => {
    for (const code of ['L-3', 'L-20', 'L-100']) await createUnit(code, { occupancy: 'rented' })
    const page = await bodyOf<{
      items: Array<{ code: string }>
      nextCursor: string | null
      summary: { total: number }
    }>(await call('/staff/units?q=l-', { token: manager }))
    expect(page.items.map((i) => i.code)).toEqual(['L-100', 'L-20', 'L-3'])
    expect(page.nextCursor).toBeNull()
    const first = await bodyOf<{
      items: Array<{ code: string }>
      nextCursor: string
      summary: { rented: number }
    }>(await call('/staff/units?occupancy=rented&limit=2', { token: manager }))
    expect(first.items).toHaveLength(2)
    expect(first.summary.rented).toBeGreaterThanOrEqual(3)
    const second = await bodyOf<{ items: unknown[] }>(
      await call(`/staff/units?occupancy=rented&limit=2&cursor=${first.nextCursor}`, {
        token: manager,
      }),
    )
    expect(second.items.length).toBeGreaterThan(0)
    expect((await errorOf(await call('/staff/units?cursor=nope', { token: manager }))).code).toBe(
      'invalid_cursor',
    )
    expect((await call('/staff/units?limit=500', { token: manager })).status).toBe(400)
    expect((await call('/staff/units?q=l', { token: manager })).status).toBe(200)
  })

  test('E-62 the history has the actor by name and pages by cursor', async () => {
    const unit = await createUnit('H-1', { occupancy: 'occupied' })
    const path = `/staff/units/${unit.unitId}`
    await call(path, {
      method: 'PATCH',
      token: manager,
      headers: { 'if-match': '"1"' },
      json: { occupancy: 'vacant' },
    })
    await call(path, {
      method: 'PATCH',
      token: manager,
      headers: { 'if-match': '"2"' },
      json: { occupancy: 'rented' },
    })
    const first = await bodyOf<{
      items: Array<{ kind: string; actor: { kind: string; name: string } }>
      nextCursor: string
    }>(await call(`${path}/history?limit=1`, { token: manager }))
    expect(first.items).toMatchObject([
      { kind: 'moved_in', actor: { kind: 'staff', name: 'Lê Văn Quản' } },
    ])
    const second = await bodyOf<{ items: Array<{ kind: string }>; nextCursor: string | null }>(
      await call(`${path}/history?limit=1&cursor=${first.nextCursor}`, { token: manager }),
    )
    expect(second.items.map((i) => i.kind)).toEqual(['moved_out'])
    expect((await call(`${path}/history`, { token: strangerManager })).status).toBe(404)
  })
})

describe('residents (E-63…E-67)', () => {
  test('E-64 adds a person: 201 with Location, replay with the key, member_exists, unit_has_owner, phone_invalid, can_pay_tenant_only', async () => {
    const unit = await createUnit('W-1')
    const body = {
      unitId: unit.unitId,
      phone: '0905000001',
      fullName: 'Trần Thị Bình',
      memberType: 'tenant',
      canPay: true,
      email: 'binh@example.com',
    }
    const key = crypto.randomUUID()
    const first = await call('/staff/residents', {
      method: 'POST',
      token: manager,
      key,
      json: body,
    })
    expect(first.status).toBe(201)
    const added = await bodyOf<{
      accountId: string
      membershipId: string
      accountCreated: boolean
    }>(first)
    expect(added.accountCreated).toBe(true)
    expect(first.headers.get('location')).toBe(`/api/v1/staff/residents/${added.accountId}`)
    const replay = await call('/staff/residents', {
      method: 'POST',
      token: manager,
      key,
      json: body,
    })
    expect(replay.headers.get('idempotent-replayed')).toBe('true')
    expect((await bodyOf<{ membershipId: string }>(replay)).membershipId).toBe(added.membershipId)

    const again = await call('/staff/residents', { method: 'POST', token: manager, json: body })
    expect(again.status).toBe(409)
    const exists = await errorOf(again)
    expect(exists.code).toBe('member_exists')
    expect(JSON.stringify(exists.details)).toContain(added.membershipId)

    const owner = { ...body, phone: '0905000002', memberType: 'owner', canPay: false }
    expect(
      (await call('/staff/residents', { method: 'POST', token: manager, json: owner })).status,
    ).toBe(201)
    const second = await call('/staff/residents', {
      method: 'POST',
      token: manager,
      json: { ...owner, phone: '0905000003' },
    })
    expect(second.status).toBe(409)
    expect((await errorOf(second)).code).toBe('unit_has_owner')

    const invalid = await call('/staff/residents', {
      method: 'POST',
      token: manager,
      json: { ...body, phone: '123' },
    })
    expect(invalid.status).toBe(400)
    const payer = await call('/staff/residents', {
      method: 'POST',
      token: manager,
      json: { ...body, phone: '0905000004', memberType: 'family' },
    })
    expect(payer.status).toBe(422)
    expect(
      (
        await call('/staff/residents', {
          method: 'POST',
          token: strangerManager,
          json: { ...body, phone: '0905000005' },
        })
      ).status,
    ).toBe(404)
  })

  test('E-65 returns the detail with the full ID number once, no-store, and writes pii.read; E-66 answers it masked', async () => {
    const unit = await createUnit('W-2')
    const added = await bodyOf<{ accountId: string }>(
      await call('/staff/residents', {
        method: 'POST',
        token: manager,
        json: {
          unitId: unit.unitId,
          phone: '0905000010',
          fullName: 'Nguyễn Văn An',
          memberType: 'owner',
        },
      }),
    )
    const path = `/staff/residents/${added.accountId}`
    const edited = await call(path, {
      method: 'PATCH',
      token: manager,
      headers: { 'if-match': '"1"' },
      json: { cccd: '079 085 012 345', dateOfBirth: '1985-04-03', email: 'an@example.com' },
    })
    expect(edited.status).toBe(200)
    expect(edited.headers.get('etag')).toBe('"2"')
    expect(await bodyOf(edited)).toEqual({
      accountId: added.accountId,
      fullName: 'Nguyễn Văn An',
      email: 'an@example.com',
      cccdMasked: '•••• 2345',
      hasDateOfBirth: true,
      note: null,
      version: 2,
    })
    const stale = await call(path, {
      method: 'PATCH',
      token: manager,
      headers: { 'if-match': '"1"' },
      json: { note: 'x' },
    })
    expect(stale.status).toBe(409)
    expect(
      (await call(path, { method: 'PATCH', token: manager, json: { note: 'x' } })).status,
    ).toBe(428)
    expect(
      (
        await call(path, {
          method: 'PATCH',
          token: manager,
          headers: { 'if-match': '"2"' },
          json: { cccd: '12a4' },
        })
      ).status,
    ).toBe(400)

    const detail = await call(path, { token: manager })
    expect(detail.status).toBe(200)
    expect(detail.headers.get('cache-control')).toBe('no-store')
    expect(await bodyOf(detail)).toMatchObject({
      phone: '+84905000010',
      profile: { cccd: '079085012345', dateOfBirth: '1985-04-03', version: 2 },
      memberships: [{ unitCode: 'W-2', memberType: 'owner' }],
    })
    const reads =
      await db.sql`SELECT 1 FROM audit.audit_log WHERE object_id = ${added.accountId} AND action = 'pii.read'`
    expect(reads).toHaveLength(1)
    expect((await call(path, { token: strangerManager })).status).toBe(404)

    const list = await call('/staff/residents?q=nguyen', { token: manager })
    const listed = await bodyOf<{ items: Array<Record<string, unknown>> }>(list)
    expect(listed.items[0]).toMatchObject({ cccdMasked: '•••• 2345', phone: '+84905000010' })
    expect(JSON.stringify(listed)).not.toContain('079085012345')
    expect(JSON.stringify(listed)).not.toContain('1985-04-03')
    expect(
      await db.sql`SELECT 1 FROM audit.audit_log WHERE object_id = ${added.accountId} AND action = 'pii.read'`,
    ).toHaveLength(1)
  })

  test('E-63 a q of 3 digits searches no phone; limit and cursor are checked', async () => {
    const found = await bodyOf<{ items: unknown[] }>(
      await call('/staff/residents?q=010', { token: manager }),
    )
    expect(found.items).toEqual([])
    expect((await call('/staff/residents?limit=0', { token: manager })).status).toBe(400)
    expect((await errorOf(await call('/staff/residents?cursor=x', { token: manager }))).code).toBe(
      'invalid_cursor',
    )
    expect(
      (await call('/staff/residents?neverSignedIn=true&deletion=requested', { token: manager }))
        .status,
    ).toBe(200)
  })

  test('RM-31 E-67 a phone change ends every session of the account; the old number no longer signs in; same number is 204', async () => {
    const unit = await createUnit('W-3')
    const resident = await seedResident(unit.unitId, 'family')
    const families =
      await db.sql`SELECT revoked_at FROM identity.refresh_family WHERE account_id = ${resident.id}`
    expect(families.every((f) => f.revoked_at === null)).toBe(true)
    const path = `/staff/residents/${resident.id}/phone`
    expect(
      (await call(path, { method: 'PATCH', token: manager, json: { phone: resident.phone } }))
        .status,
    ).toBe(204)
    expect(
      (
        await db.sql`SELECT revoked_at FROM identity.refresh_family WHERE account_id = ${resident.id}`
      ).every((f) => f.revoked_at === null),
    ).toBe(true)
    const changed = await call(path, {
      method: 'PATCH',
      token: manager,
      json: { phone: '0987000001' },
    })
    expect(changed.status).toBe(204)
    const revoked =
      await db.sql`SELECT revoked_reason FROM identity.refresh_family WHERE account_id = ${resident.id}`
    expect(revoked.map((f) => f.revoked_reason)).toEqual(revoked.map(() => 'phone_changed'))
    const events =
      await db.sql`SELECT 1 FROM identity.outbox_messages WHERE type = 'identity.session_revoked.v1' AND payload->>'accountId' = ${resident.id}`
    expect(events.length).toBeGreaterThan(0)
    const [account] =
      await db.sql`SELECT phone FROM identity.resident_account WHERE id = ${resident.id}`
    expect(account?.phone).toBe('+84987000001')
    const [membership] =
      await db.sql`SELECT credential_version FROM residency.membership WHERE id = ${resident.membershipId}`
    expect(membership?.credential_version).toBe(1)
    const other = await seedResident(unit.unitId, 'tenant')
    const taken = await call(path, {
      method: 'PATCH',
      token: manager,
      json: { phone: other.phone },
    })
    expect(taken.status).toBe(409)
    expect((await errorOf(taken)).code).toBe('phone_in_use')
    expect(
      (await call(path, { method: 'PATCH', token: manager, json: { phone: '12' } })).status,
    ).toBe(400)
    expect(
      (await call(path, { method: 'PATCH', token: strangerManager, json: { phone: '0987000002' } }))
        .status,
    ).toBe(404)
  })
})

describe('ownership and memberships (E-61, E-69)', () => {
  test("RM-23 a transfer ends the old owner's and the members' access on their next request", async () => {
    const unit = await createUnit('X-1')
    const owner = await seedResident(unit.unitId, 'owner')
    const helper = await seedResident(unit.unitId, 'helper')
    expect((await asUnit('/me/notices', owner.token, unit.unitId)).status).toBe(200)
    expect((await asUnit('/me/notices', helper.token, unit.unitId)).status).toBe(200)
    const path = `/staff/units/${unit.unitId}/owner`
    const body = {
      phone: '0905100001',
      fullName: 'Trần Thị Bình',
      reason: 'Sold on 2026-10-15; contract 15/2026',
    }
    expect((await call(path, { method: 'POST', token: manager, json: body })).status).toBe(428)
    const short = await call(path, {
      method: 'POST',
      token: manager,
      headers: { 'if-match': '"1"' },
      json: { ...body, reason: 'no' },
    })
    expect(short.status).toBe(422)
    const done = await call(path, {
      method: 'POST',
      token: manager,
      headers: { 'if-match': '"1"' },
      json: body,
    })
    expect(done.status).toBe(200)
    expect(done.headers.get('etag')).toBe('"2"')
    expect(await bodyOf(done)).toMatchObject({
      unit: { code: 'X-1', version: 2 },
      removedMembers: 2,
      accountCreated: true,
    })
    for (const resident of [owner, helper]) {
      const refused = await asUnit('/me/notices', resident.token, unit.unitId)
      expect(refused.status).toBe(403)
      expect((await errorOf(refused)).code).toBe('membership_inactive')
    }
    const detail = await bodyOf<{ owner: { phone: string } }>(
      await call(`/staff/units/${unit.unitId}`, { token: manager }),
    )
    expect(detail.owner.phone).toBe('+84905100001')
    const again = await call(path, {
      method: 'POST',
      token: manager,
      headers: { 'if-match': '"1"' },
      json: { ...body, phone: '0905100002' },
    })
    expect(again.status).toBe(409)
    expect((await errorOf(again)).code).toBe('version_conflict')
    expect(
      (
        await call(path, {
          method: 'POST',
          token: strangerManager,
          headers: { 'if-match': '"2"' },
          json: body,
        })
      ).status,
    ).toBe(404)
  })

  test('E-69 locks, unlocks, retypes and removes one membership; one change per request; the owner row only by transfer', async () => {
    const unit = await createUnit('X-2')
    const owner = await seedResident(unit.unitId, 'owner')
    const tenant = await seedResident(unit.unitId, 'tenant')
    const patch = (id: string, json: unknown, token = manager) =>
      call(`/staff/memberships/${id}`, { method: 'PATCH', token, json })
    const locked = await patch(tenant.membershipId, { status: 'locked' })
    expect(locked.status).toBe(200)
    expect(await bodyOf(locked)).toMatchObject({
      membershipId: tenant.membershipId,
      status: 'locked',
      lockedBy: 'manager',
      memberType: 'tenant',
    })
    expect((await errorOf(await asUnit('/me/notices', tenant.token, unit.unitId))).code).toBe(
      'membership_inactive',
    )
    expect((await errorOf(await patch(tenant.membershipId, { status: 'locked' }))).code).toBe(
      'invalid_transition',
    )
    expect(
      (await bodyOf<{ status: string }>(await patch(tenant.membershipId, { status: 'active' })))
        .status,
    ).toBe('active')
    expect(
      (
        await bodyOf<{ memberType: string }>(
          await patch(tenant.membershipId, { memberType: 'family' }),
        )
      ).memberType,
    ).toBe('family')
    expect((await errorOf(await patch(tenant.membershipId, { canPay: true }))).code).toBe(
      'validation_failed',
    )
    const two = await patch(tenant.membershipId, { status: 'locked', canPay: true })
    expect(two.status).toBe(400)
    expect(JSON.stringify((await errorOf(two)).details)).toContain('one_change_only')
    expect((await patch(tenant.membershipId, {})).status).toBe(400)
    expect((await patch(tenant.membershipId, { memberType: 'owner' })).status).toBe(400)
    expect((await errorOf(await patch(owner.membershipId, { status: 'removed' }))).code).toBe(
      'owner_must_transfer',
    )
    expect((await errorOf(await patch(owner.membershipId, { memberType: 'family' }))).code).toBe(
      'owner_must_transfer',
    )
    expect((await patch(tenant.membershipId, { status: 'removed' })).status).toBe(200)
    expect((await patch(tenant.membershipId, { status: 'removed' }, strangerManager)).status).toBe(
      404,
    )
    expect((await patch(crypto.randomUUID(), { status: 'locked' })).status).toBe(404)
  })
})

describe('E-68 approve a deletion request (DOC-35 §10.1)', () => {
  const approve = (accountId: string, token = manager) =>
    call(`/staff/residents/${accountId}/deletion/approve`, { method: 'POST', token, key: null })
  const request = (accountId: string, requestedAt = '2026-10-18T02:00:00Z') =>
    db.sql`UPDATE identity.resident_account SET status = 'deletion_requested', deletion_requested_at = ${requestedAt}
            WHERE id = ${accountId}`

  test('AD-39 approves with the date and the execution; a second approval answers the same dates and writes one audit row; an active account is 409', async () => {
    const unit = await createUnit('D-1')
    const family = await seedResident(unit.unitId, 'family')
    expect((await errorOf(await approve(family.id))).code).toBe('deletion_not_requested')
    await request(family.id)
    const first = await approve(family.id)
    expect(first.status).toBe(200)
    const body = await bodyOf<Record<string, string>>(first)
    expect(body.accountId).toBe(family.id)
    expect(body.deletionRequestedAt).toBe('2026-10-18T02:00:00.000Z')
    expect(
      Date.parse(body.executeAfter as string) - Date.parse(body.deletionApprovedAt as string),
    ).toBe(30 * 86_400_000)
    expect(await bodyOf(await approve(family.id, admin))).toEqual(body)
    const audit = await db.sql`
      SELECT actor_kind, changes FROM audit.audit_log
       WHERE object_id = ${family.id} AND action = 'identity.account.deletion_approve'`
    expect(audit).toHaveLength(1)
    expect(JSON.stringify(audit[0]?.changes)).toContain('deletionApprovedAt')
    const [row] = await db.sql`SELECT status FROM identity.resident_account WHERE id = ${family.id}`
    expect(row?.status).toBe('deletion_requested')
    const listed = await bodyOf<{
      items: Array<{ accountId: string; deletion: { approvedAt: string | null } }>
    }>(await call('/staff/residents?deletion=requested', { token: manager }))
    expect(listed.items.find((item) => item.accountId === family.id)?.deletion.approvedAt).toBe(
      body.deletionApprovedAt,
    )
  })

  test('AD-41 the active owner of a unit is 409 owner_must_transfer with the unit ids; after a transfer the approval passes', async () => {
    const unit = await createUnit('D-2')
    const owner = await seedResident(unit.unitId, 'owner')
    await request(owner.id)
    const refused = await errorOf(await approve(owner.id))
    expect(refused.code).toBe('owner_must_transfer')
    expect(refused.details).toEqual({ unitIds: [unit.unitId] })
    expect(
      await db.sql`SELECT 1 FROM identity.resident_account WHERE id = ${owner.id} AND deletion_approved_at IS NOT NULL`,
    ).toHaveLength(0)
    await db.sql`UPDATE residency.membership SET status = 'removed', removed_at = now() WHERE id = ${owner.membershipId}`
    expect((await approve(owner.id)).status).toBe(200)
  })

  test('AD-45 the setting accountDeletionDays sets the execution date', async () => {
    const saveDays = async (days: number | null) => {
      const read = await call('/staff/settings', { token: admin })
      const saved = await call('/staff/settings', {
        method: 'PATCH',
        token: admin,
        headers: { 'if-match': read.headers.get('etag') as string },
        json: { settings: { accountDeletionDays: days } },
      })
      expect(saved.status).toBe(200)
    }
    await saveDays(7)
    try {
      const unit = await createUnit('D-3')
      const tenant = await seedResident(unit.unitId, 'tenant')
      await request(tenant.id)
      const body = await bodyOf<Record<string, string>>(await approve(tenant.id))
      expect(
        Date.parse(body.executeAfter as string) - Date.parse(body.deletionApprovedAt as string),
      ).toBe(7 * 86_400_000)
    } finally {
      await saveDays(null)
    }
  })

  test('an account with no profile here, an unknown id and a deleted account are 404; other roles and buildings are refused', async () => {
    const unit = await createUnit('D-4')
    const family = await seedResident(unit.unitId, 'family')
    await request(family.id)
    expect((await approve(family.id, strangerManager)).status).toBe(404)
    expect((await approve(crypto.randomUUID())).status).toBe(404)
    expect((await approve(family.id, technician)).status).toBe(403)
    expect((await approve(family.id, guard)).status).toBe(403)
    await db.sql`UPDATE identity.resident_account SET status = 'deleted', deleted_at = now(), phone = ${`deleted:${family.id}`} WHERE id = ${family.id}`
    expect((await approve(family.id)).status).toBe(404)
  })

  test('two approvals at once change one row and write one audit row', async () => {
    const unit = await createUnit('D-5')
    const family = await seedResident(unit.unitId, 'family')
    await request(family.id)
    const results = await Promise.all([approve(family.id), approve(family.id), approve(family.id)])
    expect(results.map((res) => res.status)).toEqual([200, 200, 200])
    const dates = await Promise.all(
      results.map(async (res) => (await bodyOf(res)).deletionApprovedAt),
    )
    expect(new Set(dates).size).toBe(1)
    expect(
      await db.sql`SELECT 1 FROM audit.audit_log WHERE object_id = ${family.id} AND action = 'identity.account.deletion_approve'`,
    ).toHaveLength(1)
  })
})
