import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { errorHandlerPlugin, requestContextPlugin, routePlugin } from '@core/http'
import { createLogger } from '@core/telemetry'
import type { BuildingId, StaffContext, StaffId } from '@rms/shared-types'
import { residentOf } from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { runBootGuard } from '../../src/bootstrap/boot-guard'
import { containerFor } from './support'

/**
 * The resident sign-in over HTTP (DOC-26 §5, §7): the OTP routes, the `resident` guard in front of `/me/*`, the terms gate of
 * DOC-35 §9.2 and the boot guard of DOC-36 §10.1 check 1, against a real PostgreSQL. The code reaches a real resident by SMS and
 * is covered by `modules/identity/test`; here the demo account (the fixed code, no SMS) is the way in.
 */

const BUILDING = '018f0000-0000-7000-8000-000000000001' as BuildingId
const DEMO_BUILDING = '018f0000-0000-7000-8000-000000000002' as BuildingId
const PASSWORD = 'Sunrise2026!'

let db: TestDb
let built: ReturnType<typeof containerFor>
let phoneCounter = 0

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
const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; details?: Record<string, unknown> } }).error

/** A resident account made as the migrator; the demo one signs in with the fixed code. */
async function seedResident(options: { isDemo: boolean }) {
  phoneCounter++
  const phone = `+84902${String(phoneCounter).padStart(6, '0')}`
  const id = crypto.randomUUID()
  await db.sql`
    INSERT INTO identity.resident_account (id, phone, display_name, is_demo)
    VALUES (${id}, ${phone}, ${`Resident ${phoneCounter}`}, ${options.isDemo})`
  return { id, phone }
}

async function signIn() {
  const resident = await seedResident({ isDemo: true })
  const requested = await call('/auth/otp', { method: 'POST', json: { phone: resident.phone } })
  expect(requested.status).toBe(202)
  const { challengeId } = (await requested.json()) as { challengeId: string }
  const verified = await call('/auth/otp/verify', {
    method: 'POST',
    json: { challengeId, code: '123456' },
  })
  expect(verified.status).toBe(200)
  const body = (await verified.json()) as {
    accessToken: string
    refreshToken: string
    expiresIn: number
    account: { id: string }
    memberships: unknown[]
  }
  return { resident, body, verified }
}

beforeAll(async () => {
  db = await cloneTemplate('empty')
  for (const [id, code, isDemo] of [
    [BUILDING, 'SUNRISE-A', false],
    [DEMO_BUILDING, 'DEMO', true],
  ] as const) {
    await db.sql`
      INSERT INTO building.building (id, code, name, company, address, hotline, is_demo)
      VALUES (${id}, ${code}, '{"vi":"Chung cư","en":"Apartments"}', '{"name":{"vi":"Công ty"},"taxCode":"0312345678"}',
              '12 Nguyễn Huệ', '1900 1234', ${isDemo})`
    await db.sql`INSERT INTO building.building_setting (building_id) VALUES (${id})`
  }
  const hash = await Bun.password.hash(PASSWORD, {
    algorithm: 'argon2id',
    memoryCost: 256,
    timeCost: 1,
  })
  await db.sql`
    INSERT INTO identity.staff_account (id, building_id, email, full_name, role, status, password_hash, language)
    VALUES (gen_random_uuid(), ${BUILDING}, 'admin@sunrise.example', 'Phạm Thu Hà', 'admin', 'active', ${hash}, 'en')`
  built = containerFor(db.url, {}, { OTP_PER_IP_PER_HOUR: '1000', TRUSTED_PROXY_HOPS: '0' })
})
afterAll(async () => {
  await built.container.close()
  await db.drop()
})

describe('POST /auth/otp and /auth/otp/verify', () => {
  test('an unregistered phone is 404 phone_not_registered, with no SMS command', async () => {
    const res = await call('/auth/otp', { method: 'POST', json: { phone: '+84909999999' } })
    expect(res.status).toBe(404)
    expect((await errorOf(res)).code).toBe('phone_not_registered')
    const [count] = await db.sql`SELECT count(*)::int AS n FROM identity.outbox_messages`
    expect(count?.n).toBe(0)
  })

  test('a number that is valid nowhere is 400 validation_failed with the rule phone_invalid', async () => {
    const res = await call('/auth/otp', { method: 'POST', json: { phone: '0123456789' } })
    expect(res.status).toBe(400)
    const error = await errorOf(res)
    expect(error.code).toBe('validation_failed')
    expect(JSON.stringify(error.details)).toContain('phone_invalid')
  })

  test('the demo account signs in with 123456: the body holds the refresh token, no cookie is set', async () => {
    const { verified, body, resident } = await signIn()
    expect(verified.headers.get('set-cookie')).toBeNull()
    expect(body.refreshToken).toBeTruthy()
    expect(body.account.id).toBe(resident.id)
    expect(body).toMatchObject({ expiresIn: 900, memberships: [] })
  })

  test('a wrong code is 400 otp_invalid with the tries left; a code that is not six digits is a validation error', async () => {
    const resident = await seedResident({ isDemo: true })
    const requested = await call('/auth/otp', { method: 'POST', json: { phone: resident.phone } })
    const { challengeId } = (await requested.json()) as { challengeId: string }
    const wrong = await call('/auth/otp/verify', {
      method: 'POST',
      json: { challengeId, code: '654321' },
    })
    expect(wrong.status).toBe(400)
    expect(await errorOf(wrong)).toMatchObject({
      code: 'otp_invalid',
      details: { attemptsLeft: 4 },
    })
    const malformed = await call('/auth/otp/verify', {
      method: 'POST',
      json: { challengeId, code: '12345' },
    })
    expect((await errorOf(malformed)).code).toBe('validation_failed')
  })

  test('SC-19: the 21st request from one address is 429 with Retry-After and the scope', async () => {
    // its own database: the bucket of the address `unknown` is a row, and the other tests spend a larger one
    const own = await cloneTemplate('empty')
    const limited = containerFor(own.url, {}, { OTP_PER_IP_PER_HOUR: '3', TRUSTED_PROXY_HOPS: '0' })
    try {
      const request = () =>
        limited.app.handle(
          new Request('http://localhost/api/v1/auth/otp', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ phone: '+84909999998' }),
          }),
        )
      const statuses: number[] = []
      for (let i = 0; i < 4; i++) statuses.push((await request()).status)
      expect(statuses).toEqual([404, 404, 404, 429])
      const refused = await request()
      expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
      expect(await errorOf(refused)).toMatchObject({
        code: 'rate_limited',
        details: { scope: 'otp' },
      })
    } finally {
      await limited.container.close()
      await own.drop()
    }
  })
})

describe('the resident guard and /me/* (AU-41)', () => {
  test('GET /me answers with a resident token and refuses none, a staff token and a garbled one', async () => {
    const { body, resident } = await signIn()
    const me = await call('/me', { token: body.accessToken })
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ account: { id: resident.id }, memberships: [] })
    expect((await call('/me')).status).toBe(401)
    expect((await call('/me', { token: 'not.a.token' })).status).toBe(401)

    const staff = await call('/auth/staff/login', {
      method: 'POST',
      json: { email: 'admin@sunrise.example', password: PASSWORD, client: 'app' },
    })
    const staffToken = ((await staff.json()) as { accessToken: string }).accessToken
    expect((await call('/me', { token: staffToken })).status).toBe(401)
    expect((await call('/me/sessions', { token: staffToken })).status).toBe(401)
    expect((await call('/staff/me', { token: body.accessToken })).status).toBe(401)
    expect((await call('/staff/sessions', { token: body.accessToken })).status).toBe(401)
  })

  test('AU-55: the session list marks the current one; a refresh rotates; revoking it ends the refresh', async () => {
    const { body } = await signIn()
    const list = await call('/me/sessions', { token: body.accessToken })
    const { items } = (await list.json()) as {
      items: Array<{ id: string; client: string; current: boolean }>
    }
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ client: 'app', current: true })

    const refreshed = await call('/auth/refresh', {
      method: 'POST',
      json: { refreshToken: body.refreshToken },
    })
    expect(refreshed.status).toBe(200)
    const next = (await refreshed.json()) as { accessToken: string; refreshToken: string }
    expect(next.refreshToken).not.toBe(body.refreshToken)

    expect(
      (await call(`/me/sessions/${items[0]?.id}`, { method: 'DELETE', token: next.accessToken }))
        .status,
    ).toBe(204)
    const dead = await call('/auth/refresh', {
      method: 'POST',
      json: { refreshToken: next.refreshToken },
    })
    expect(dead.status).toBe(401)
    const missing = await call(`/me/sessions/${crypto.randomUUID()}`, {
      method: 'DELETE',
      token: next.accessToken,
    })
    expect(missing.status).toBe(404)
  })
})

describe('PATCH /me and GET /me/contact (E-14, E-15; UIRQ-03, UIRQ-04)', () => {
  test('E-14: the language and the push toggle are saved, and the next GET /me shows them', async () => {
    const { body, resident } = await signIn()
    const patched = await call('/me', {
      method: 'PATCH',
      token: body.accessToken,
      json: { language: 'en', pushEnabled: true },
    })
    expect(patched.status).toBe(200)
    expect(await patched.json()).toMatchObject({
      id: resident.id,
      language: 'en',
      pushEnabled: true,
    })
    const me = await call('/me', { token: body.accessToken })
    expect(await me.json()).toMatchObject({ account: { language: 'en', pushEnabled: true } })
    // A key alone leaves the other one as it is.
    const again = await call('/me', {
      method: 'PATCH',
      token: body.accessToken,
      json: { pushEnabled: false },
    })
    expect(await again.json()).toMatchObject({ language: 'en', pushEnabled: false })
  })

  test('E-14: the name and the phone are not editable, an empty body and a bad language are 400, no token is 401', async () => {
    const { body } = await signIn()
    for (const json of [
      { displayName: 'Someone' },
      { phone: '+84901111111' },
      {},
      { language: 'fr' },
    ]) {
      const res = await call('/me', { method: 'PATCH', token: body.accessToken, json })
      expect(res.status).toBe(400)
      expect((await errorOf(res)).code).toBe('validation_failed')
    }
    expect((await call('/me', { method: 'PATCH', json: { language: 'en' } })).status).toBe(401)
  })

  test('E-15: a resident with no unit gets the deployment building contact; no token is 401', async () => {
    const { body } = await signIn()
    const res = await call('/me/contact', { token: body.accessToken })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, max-age=60')
    expect(await res.json()).toMatchObject({
      name: { vi: 'Chung cư', en: 'Apartments' },
      hotline: '1900 1234',
    })
    expect((await call('/me/contact')).status).toBe(401)
  })
})

describe('the terms gate (DOC-35 §9.2)', () => {
  const admin = (): StaffContext => ({
    buildingId: BUILDING,
    staffId: crypto.randomUUID() as StaffId,
    role: 'admin',
    scope: { buildingId: BUILDING },
  })
  const text = (label: string) => ({ vi: `## ${label}\n\nNội dung`, en: `## ${label}\n\nBody` })

  test('AD-37, AD-32, AD-33: nothing is required until a version is published; then the next request is refused until it is accepted', async () => {
    const { resident, body } = await signIn()
    const { termsGate } = built.container

    await expect(termsGate(resident.id, BUILDING)).resolves.toBeUndefined()

    const v1 = await built.container.building.useCases.publishTerms.execute(admin(), {
      kind: 'terms',
      text: text('Terms'),
    })
    const refused = await termsGate(resident.id, BUILDING).then(
      () => null,
      (error: unknown) => error as { code: string; kind: string; details: unknown },
    )
    expect(refused).toMatchObject({
      code: 'terms_required',
      kind: 'forbidden',
      details: { required: [{ kind: 'terms', version: 1, versionId: v1.id }] },
    })

    // the routes that need no building answer all the same: the gate is inside `unit(capability)`, not in front of `/me`
    expect((await call('/me', { token: body.accessToken })).status).toBe(200)
    expect((await call('/me/sessions', { token: body.accessToken })).status).toBe(200)

    await built.container.building.useCases.acceptTerms.execute({
      accountId: resident.id,
      buildingId: BUILDING,
      versionIds: [v1.id],
      ip: null,
      appVersion: null,
    })
    await expect(termsGate(resident.id, BUILDING)).resolves.toBeUndefined()

    // version 2: the very next request is refused again (FR-41.1), with only the kind that is not accepted (AD-34)
    const v2 = await built.container.building.useCases.publishTerms.execute(admin(), {
      kind: 'terms',
      text: text('Terms 2'),
    })
    const again = await termsGate(resident.id, BUILDING).then(
      () => null,
      (error: unknown) => error as { details: { required: unknown[] } },
    )
    expect(again?.details.required).toEqual([{ kind: 'terms', version: 2, versionId: v2.id }])
  })

  test('the gate answers 403 terms_required over HTTP behind the resident guard, and a route without it passes', async () => {
    const { body } = await signIn()
    const { guards, termsGate } = built.container
    const probe = routePlugin({ prefix: '/api/v1' })
      .use(requestContextPlugin)
      .use(errorHandlerPlugin({ logger: createLogger('silent') }))
      .get('/me/fees', () => ({ ok: true }), {
        transform: [
          guards.resident().transform,
          async (context) => termsGate(residentOf(context).accountId, BUILDING),
        ],
      })
    const request = (token?: string) =>
      probe.handle(
        new Request('http://localhost/api/v1/me/fees', {
          headers: token ? { authorization: `Bearer ${token}` } : {},
        }),
      )
    expect((await request()).status).toBe(401)
    const refused = await request(body.accessToken)
    expect(refused.status).toBe(403)
    expect((await errorOf(refused)).code).toBe('terms_required')
  })
})

describe('boot guard check 1 (AU-27, BD-30, DR-37, DR-60)', () => {
  test('a flagged account in a building that is not a demo building is a failure; in the demo building it is not', async () => {
    const flagged = await seedResident({ isDemo: true })
    const membership = (buildingId: BuildingId) => ({
      buildingIdsOfAccounts: async (ids: readonly string[]) =>
        ids.includes(flagged.id) ? [buildingId] : [],
    })
    const { container } = built
    const guard = (buildingId: BuildingId) => ({
      ...container.bootGuard,
      accountBuildings: membership(buildingId),
    })
    expect(await runBootGuard(guard(DEMO_BUILDING))).toEqual([])
    const failures = await runBootGuard(guard(BUILDING))
    expect(failures).toEqual([expect.objectContaining({ check: 1, ids: [BUILDING] })])
  })

  test('with no flagged account nothing is asked of residency', async () => {
    const empty = await cloneTemplate('empty')
    const other = containerFor(empty.url)
    try {
      let asked = 0
      const failures = await runBootGuard({
        ...other.container.bootGuard,
        accountBuildings: {
          buildingIdsOfAccounts: async () => {
            asked++
            return [BUILDING]
          },
        },
      })
      expect(failures).toEqual([])
      expect(asked).toBe(0)
    } finally {
      await other.container.close()
      await empty.drop()
    }
  })
})
