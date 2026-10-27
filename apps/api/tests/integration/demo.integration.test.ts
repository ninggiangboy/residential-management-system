import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { runBootGuard } from '../../src/bootstrap/boot-guard'
import { DEMO_BUILDING_ID } from '../../src/demo/plan'
import { containerFor } from './support'

/**
 * The demo building over a real PostgreSQL and the real container (DOC-36 §9, §10; BD-28…BD-32, BD-37…BD-43): the seed of
 * `seed:demo`, the sign-in of the demo accounts, `POST /staff/demo/reset` (E-56), the nightly job and the boot guard.
 */

const REAL = '018f0000-0000-7000-8000-000000000001'
const PASSWORD = 'demo-password-1'
const REAL_PASSWORD = 'Sunrise2026!'

let db: TestDb
let built: ReturnType<typeof containerFor>

const call = (path: string, init: RequestInit & { token?: string; json?: unknown } = {}) => {
  const { token, json, headers, ...rest } = init
  return built.app.handle(
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
const count = async (table: string, where = 'true') =>
  Number((await db.sql.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0]?.n)

async function staffSignIn(email: string, password = PASSWORD) {
  const res = await call('/auth/staff/login', {
    method: 'POST',
    json: { email, password, client: 'app' },
  })
  expect(res.status).toBe(200)
  return (await res.json()) as { accessToken: string; refreshToken: string }
}

async function residentSignIn(phone: string) {
  const requested = await call('/auth/otp', { method: 'POST', json: { phone } })
  expect(requested.status).toBe(202)
  const { challengeId } = (await requested.json()) as { challengeId: string }
  const verified = await call('/auth/otp/verify', {
    method: 'POST',
    json: { challengeId, code: '123456' },
  })
  expect(verified.status).toBe(200)
  return (await verified.json()) as {
    accessToken: string
    refreshToken: string
    memberships: Array<{ unitCode: string; memberType: string }>
  }
}

beforeAll(async () => {
  db = await cloneTemplate('empty')
  // A real building with its own Admin, in the same database: the demo must never touch it.
  await db.sql`
    INSERT INTO building.building (id, code, name, company, address, hotline, is_demo)
    VALUES (${REAL}, 'SUNRISE-A', '{"vi":"Chung cư Sunrise A","en":"Sunrise A Apartments"}',
            '{"name":{"vi":"Công ty Sunrise"},"taxCode":"0312345678"}', '12 Nguyễn Huệ', '1900 1234', false)`
  await db.sql`INSERT INTO building.building_setting (building_id) VALUES (${REAL})`
  const hash = await Bun.password.hash(REAL_PASSWORD, {
    algorithm: 'argon2id',
    memoryCost: 256,
    timeCost: 1,
  })
  await db.sql`
    INSERT INTO identity.staff_account (id, building_id, email, full_name, role, status, password_hash, language)
    VALUES (gen_random_uuid(), ${REAL}, 'admin@sunrise.example', 'Phạm Thu Hà', 'admin', 'active', ${hash}, 'en'),
           (gen_random_uuid(), ${REAL}, 'manager@sunrise.example', 'Lê Văn Quản', 'manager', 'active', ${hash}, 'en')`
  built = containerFor(
    db.url,
    {},
    { DEMO_STAFF_PASSWORD: PASSWORD, OTP_PER_IP_PER_HOUR: '1000', TRUSTED_PROXY_HOPS: '0' },
  )
  const { demo } = built.container.building
  await demo.ensureBuilding.execute(built.container.demoPlan.building)
  await demo.reset.run(DEMO_BUILDING_ID)
})
afterAll(async () => {
  await built.container.close()
  await db.drop()
})

describe('the seed of DOC-36 §9.1', () => {
  test('240 units, 4 staff, 8 residents and their 9 memberships, with the gateway and the terms of the demo building', async () => {
    const demo = `building_id = '${DEMO_BUILDING_ID}'`
    expect(await count('residency.unit', demo)).toBe(240)
    expect(await count('residency.unit', `${demo} AND occupancy = 'occupied'`)).toBe(200)
    expect(await count('residency.unit', `${demo} AND occupancy = 'rented'`)).toBe(25)
    expect(await count('residency.unit', `${demo} AND occupancy = 'vacant'`)).toBe(15)
    expect(await count('identity.staff_account', demo)).toBe(4)
    expect(await count('identity.resident_account', 'is_demo')).toBe(8)
    expect(await count('residency.membership', demo)).toBe(9)
    expect(await count('building.gateway_config', `${demo} AND driver = 'fake'`)).toBe(1)
    expect(await count('building.terms_version', demo)).toBe(2)
  })

  test('the real building is not touched by the seed', async () => {
    expect(await count('identity.staff_account', `building_id = '${REAL}'`)).toBe(2)
    expect(await count('residency.unit', `building_id = '${REAL}'`)).toBe(0)
  })

  test('the demo Admin signs in with the demo password', async () => {
    const { accessToken } = await staffSignIn('admin@demo.rms.invalid')
    const me = await call('/staff/me', { token: accessToken })
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ role: 'admin', email: 'admin@demo.rms.invalid' })
  })

  test('BD-32 the demo owner signs in with 123456 and sees A-1508; a real account does not take the fixed code', async () => {
    const owner = await residentSignIn('+12025550101')
    expect(owner.memberships.map((m) => [m.unitCode, m.memberType])).toEqual([['A-1508', 'owner']])
    const multi = await residentSignIn('+12025550107')
    expect(multi.memberships.map((m) => m.unitCode)).toEqual(['A-0505', 'A-0506'])

    await db.sql`
      INSERT INTO identity.resident_account (id, phone, display_name, is_demo)
      VALUES (gen_random_uuid(), '+84909990001', 'Real Resident', false)`
    const requested = await call('/auth/otp', { method: 'POST', json: { phone: '+84909990001' } })
    const { challengeId } = (await requested.json()) as { challengeId: string }
    const refused = await call('/auth/otp/verify', {
      method: 'POST',
      json: { challengeId, code: '123456' },
    })
    expect(refused.status).toBe(400)
    expect(await errorCode(refused)).toBe('otp_invalid')
  })
})

describe('POST /staff/demo/reset (E-56)', () => {
  test('BD-42 the Admin of the real building gets 404 not_found, and so does anybody without the role 403', async () => {
    const real = await staffSignIn('admin@sunrise.example', REAL_PASSWORD)
    const refused = await call('/staff/demo/reset', { method: 'POST', token: real.accessToken })
    expect(refused.status).toBe(404)
    expect(await errorCode(refused)).toBe('not_found')
    const manager = await staffSignIn('manager@demo.rms.invalid')
    expect(
      (await call('/staff/demo/reset', { method: 'POST', token: manager.accessToken })).status,
    ).toBe(403)
    expect((await call('/staff/demo/reset', { method: 'POST' })).status).toBe(401)
    expect(await count('audit.audit_log', `action = 'building.demo.reset'`)).toBe(0)
  })

  test('BD-38 the demo Admin resets: the answer carries the counts, every demo session ends and the seed is back with its ids', async () => {
    const admin = await staffSignIn('admin@demo.rms.invalid')
    const owner = await residentSignIn('+12025550101')
    await db.sql`UPDATE residency.unit SET note = 'edited in the demo' WHERE building_id = ${DEMO_BUILDING_ID} AND code = 'A-0101'`
    const unitIds = (
      await db.sql`SELECT id FROM residency.unit WHERE building_id = ${DEMO_BUILDING_ID} ORDER BY code`
    ).map((row) => row.id)

    const res = await call('/staff/demo/reset', { method: 'POST', token: admin.accessToken })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      durationMs: number
      deleted: Record<string, number>
      created: Record<string, number>
    }
    expect(body.created).toMatchObject({
      'residency.unit': 240,
      'identity.staff_account': 4,
      'identity.resident_account': 8,
      'residency.membership': 9,
    })
    expect(body.deleted).toMatchObject({ 'residency.unit': 240, 'identity.staff_account': 4 })
    // BD-40: the budget on the staging host is 10 s; the laptop is no slower.
    expect(body.durationMs).toBeLessThan(10_000)

    expect(
      (
        await db.sql`SELECT id FROM residency.unit WHERE building_id = ${DEMO_BUILDING_ID} ORDER BY code`
      ).map((row) => row.id),
    ).toEqual(unitIds)
    expect(
      (
        await db.sql`SELECT note FROM residency.unit WHERE building_id = ${DEMO_BUILDING_ID} AND code = 'A-0101'`
      )[0]?.note,
    ).toBeNull()
    for (const dead of [admin.refreshToken, owner.refreshToken]) {
      const refreshed = await call('/auth/refresh', {
        method: 'POST',
        json: { refreshToken: dead },
      })
      expect(refreshed.status).toBe(401)
    }
    // The accounts are back: both sign in again.
    await staffSignIn('admin@demo.rms.invalid')
    expect((await residentSignIn('+12025550101')).memberships).toHaveLength(1)

    const audit =
      await db.sql`SELECT object_id, details FROM audit.audit_log WHERE action = 'building.demo.reset'`
    expect(audit).toHaveLength(1)
    expect(audit[0]?.object_id).toBe(DEMO_BUILDING_ID)
    expect(audit[0]?.details).toMatchObject({ units: 240 })
  })

  test('the second press within a minute is 429 rate_limited', async () => {
    const admin = await staffSignIn('admin@demo.rms.invalid')
    const res = await call('/staff/demo/reset', { method: 'POST', token: admin.accessToken })
    expect(res.status).toBe(429)
    expect(await errorCode(res)).toBe('rate_limited')
    expect(res.headers.get('retry-after')).toBeTruthy()
  })

  test('the real building is untouched by every reset', async () => {
    expect(await count('identity.staff_account', `building_id = '${REAL}'`)).toBe(2)
    expect(await count('building.building', `id = '${REAL}' AND NOT is_demo`)).toBe(1)
    expect(await count('building.building_setting', `building_id = '${REAL}'`)).toBe(1)
  })
})

describe('the nightly job (DOC-36 §10.3)', () => {
  test('BD-43 resets the demo building and writes no audit row', async () => {
    const before = await count('audit.audit_log')
    const event = await built.container.runtime.jobs.runNow('demo_reset')
    expect(event).toMatchObject({ name: 'demo_reset', status: 'succeeded', did: 1 })
    expect(await count('audit.audit_log')).toBe(before)
    expect(await count('residency.unit', `building_id = '${DEMO_BUILDING_ID}'`)).toBe(240)
    expect(await count('residency.unit', `building_id = '${REAL}'`)).toBe(0)
  })
})

describe('the boot guard on the seeded database (DOC-36 §10.1)', () => {
  test('passes: the demo accounts are in the demo building, the only gateway is a fake one on it, the keys are in the ring', async () => {
    expect(await runBootGuard(built.container.bootGuard)).toEqual([])
  })

  test('BD-28 a fake gateway on the real building fails check 2 and names the row', async () => {
    const id = crypto.randomUUID()
    const [blob] = await db.sql`SELECT secrets_enc FROM building.gateway_config LIMIT 1`
    await db.sql`
      INSERT INTO building.gateway_config (id, building_id, provider, driver, secrets_enc, receiving_account)
      VALUES (${id}, ${REAL}, 'payos', 'fake', ${String(blob?.secrets_enc)}, '{}'::jsonb)`
    try {
      const failures = await runBootGuard(built.container.bootGuard)
      expect(failures).toEqual([expect.objectContaining({ check: 2, ids: [id] })])
    } finally {
      await db.sql`DELETE FROM building.gateway_config WHERE id = ${id}`
    }
  })

  test('BD-29 a secret sealed with a key that the ring lacks fails check 6 and names the key', async () => {
    await db.sql`
      UPDATE building.gateway_config SET secrets_enc = replace(secrets_enc, 'v1:k1:', 'v1:k9:') WHERE building_id = ${DEMO_BUILDING_ID}`
    try {
      const failures = await runBootGuard(built.container.bootGuard)
      expect(failures).toEqual([expect.objectContaining({ check: 6, ids: ['settings:k9'] })])
    } finally {
      await db.sql`
        UPDATE building.gateway_config SET secrets_enc = replace(secrets_enc, 'v1:k9:', 'v1:k1:') WHERE building_id = ${DEMO_BUILDING_ID}`
    }
  })

  test('BD-30 a flagged demo account with a membership in the real building fails check 1', async () => {
    const [account] = await db.sql`SELECT id FROM identity.resident_account WHERE is_demo LIMIT 1`
    const [unit] = await db.sql`
      INSERT INTO residency.unit (id, building_id, code) VALUES (gen_random_uuid(), ${REAL}, 'R-0101') RETURNING id`
    await db.sql`
      INSERT INTO residency.membership (id, building_id, account_id, unit_id, member_type, added_by_kind, added_by)
      VALUES (gen_random_uuid(), ${REAL}, ${String(account?.id)}, ${String(unit?.id)}, 'family', 'staff', gen_random_uuid())`
    try {
      const failures = await runBootGuard(built.container.bootGuard)
      expect(failures).toEqual([expect.objectContaining({ check: 1, ids: [REAL] })])
    } finally {
      await db.sql`DELETE FROM residency.membership WHERE building_id = ${REAL}`
      await db.sql`DELETE FROM residency.unit WHERE building_id = ${REAL}`
    }
  })
})
