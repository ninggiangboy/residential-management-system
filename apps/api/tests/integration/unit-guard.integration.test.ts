import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { errorHandlerPlugin, requestContextPlugin, routePlugin, unitRoute } from '@core/http'
import { createLogger } from '@core/telemetry'
import type { BuildingId, StaffContext, StaffId } from '@rms/shared-types'
import { unitOf } from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { runBootGuard } from '../../src/bootstrap/boot-guard'
import { containerFor } from './support'

/**
 * The `unit(capability)` guard and `/me/terms` over HTTP against a real PostgreSQL (DOC-27 §3, DOC-35 §9, RM-01, RM-03…RM-05,
 * RM-07, RM-08, RM-50, AD-32, AD-33): the membership is read on every request, so a lock applies to the very next one.
 */

const BUILDING = '018f0000-0000-7000-8000-000000000001' as BuildingId
const DEMO_BUILDING = '018f0000-0000-7000-8000-000000000002' as BuildingId
const PASSWORD = 'Sunrise2026!'

let db: TestDb
let built: ReturnType<typeof containerFor>
let probe: { handle(request: Request): Promise<Response> | Response }
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

/** The routes that carry the guard: the feature routes (fees, tickets…) of later tasks look the same. */
const asUnit = (path: string, token?: string, unitId?: string) =>
  probe.handle(
    new Request(`http://localhost/api/v1${path}`, {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(unitId ? { 'x-unit-id': unitId } : {}),
      },
    }),
  )

const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; details?: unknown } }).error

const manager = (): StaffContext => ({
  buildingId: BUILDING,
  staffId: crypto.randomUUID() as StaffId,
  role: 'manager',
  scope: { buildingId: BUILDING },
})

/** A demo account signs in with the fixed code, which is the way to a real token without an SMS. */
async function signIn() {
  phoneCounter++
  const phone = `+84903${String(phoneCounter).padStart(6, '0')}`
  const id = crypto.randomUUID()
  await db.sql`
    INSERT INTO identity.resident_account (id, phone, display_name, is_demo)
    VALUES (${id}, ${phone}, ${`Resident ${phoneCounter}`}, true)`
  const requested = await call('/auth/otp', { method: 'POST', json: { phone } })
  const { challengeId } = (await requested.json()) as { challengeId: string }
  const verified = await call('/auth/otp/verify', {
    method: 'POST',
    json: { challengeId, code: '123456' },
  })
  expect(verified.status).toBe(200)
  const body = (await verified.json()) as {
    accessToken: string
    memberships: Array<{ unitId: string }>
  }
  return { id, token: body.accessToken, body }
}

let unitCounter = 0
async function seedUnit(buildingId: BuildingId = BUILDING) {
  unitCounter++
  const id = crypto.randomUUID()
  await db.sql`
    INSERT INTO residency.unit (id, building_id, code, floor, occupancy)
    VALUES (${id}, ${buildingId}, ${`A-${2000 + unitCounter}`}, 15, 'occupied')`
  return { id, code: `A-${2000 + unitCounter}` }
}

async function seedMembership(
  accountId: string,
  unitId: string,
  memberType: 'owner' | 'family' | 'tenant' | 'helper',
  extra: { canPay?: boolean; buildingId?: BuildingId } = {},
) {
  const id = crypto.randomUUID()
  await db.sql`
    INSERT INTO residency.membership (id, building_id, account_id, unit_id, member_type, can_pay, added_by_kind, added_by)
    VALUES (${id}, ${extra.buildingId ?? BUILDING}, ${accountId}, ${unitId}, ${memberType}, ${extra.canPay ?? false}, 'staff', ${crypto.randomUUID()})`
  return id
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
  const { guards } = built.container
  probe = routePlugin({ prefix: '/api/v1' })
    .use(requestContextPlugin)
    .use(errorHandlerPlugin({ logger: createLogger('silent') }))
    .get(
      '/me/notices',
      (context) => ({ memberType: unitOf(context).memberType }),
      unitRoute(guards, 'test', 'broadcast_notices', {
        endpoint: 'T-01',
        operationId: 'probeNotices',
        summary: 'probeNotices',
      }),
    )
    .get(
      '/me/fees',
      (context) => ({ startedAt: unitOf(context).startedAt.toISOString() }),
      unitRoute(guards, 'test', 'view_fees', {
        endpoint: 'T-02',
        operationId: 'probeFees',
        summary: 'probeFees',
      }),
    )
    .get(
      '/me/payments',
      () => ({ ok: true }),
      unitRoute(guards, 'test', 'pay', {
        endpoint: 'T-03',
        operationId: 'probePay',
        summary: 'probePay',
      }),
    )
    .get(
      '/me/members',
      () => ({ ok: true }),
      unitRoute(guards, 'test', 'manage_members', {
        endpoint: 'T-04',
        operationId: 'probeMembers',
        summary: 'probeMembers',
      }),
    )
})
afterAll(async () => {
  await built.container.close()
  await db.drop()
})

describe('the unit guard', () => {
  test('the sign-in answer lists the active memberships with the unit code, locked ones left out', async () => {
    phoneCounter++
    const phone = `+84903${String(phoneCounter).padStart(6, '0')}`
    const id = crypto.randomUUID()
    await db.sql`INSERT INTO identity.resident_account (id, phone, display_name, is_demo) VALUES (${id}, ${phone}, 'Có căn', true)`
    const unit = await seedUnit()
    const lockedUnit = await seedUnit()
    const membership = await seedMembership(id, unit.id, 'owner')
    const lockedId = await seedMembership(id, lockedUnit.id, 'family')
    await built.container.residency.useCases.changeMembership.execute(manager(), lockedId, {
      status: 'locked',
    })
    const requested = await call('/auth/otp', { method: 'POST', json: { phone } })
    const { challengeId } = (await requested.json()) as { challengeId: string }
    const verified = await call('/auth/otp/verify', {
      method: 'POST',
      json: { challengeId, code: '123456' },
    })
    const body = (await verified.json()) as { accessToken: string; memberships: unknown[] }
    expect(body.memberships).toEqual([
      expect.objectContaining({
        membershipId: membership,
        unitId: unit.id,
        unitCode: unit.code,
        memberType: 'owner',
      }),
    ])
    const me = await call('/me', { token: body.accessToken })
    expect(((await me.json()) as { memberships: unknown[] }).memberships).toHaveLength(1)
  })

  test('RM-01, RM-04 the owner locks a helper: the very next request with the same token is 403 membership_inactive', async () => {
    const helper = await signIn()
    const unit = await seedUnit()
    const id = await seedMembership(helper.id, unit.id, 'helper')
    const ok = await asUnit('/me/notices', helper.token, unit.id)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ memberType: 'helper' })
    await built.container.residency.useCases.changeMembership.execute(manager(), id, {
      status: 'locked',
    })
    const refused = await asUnit('/me/notices', helper.token, unit.id)
    expect(refused.status).toBe(403)
    expect((await errorOf(refused)).code).toBe('membership_inactive')
    await built.container.residency.useCases.changeMembership.execute(manager(), id, {
      status: 'active',
    })
    expect((await asUnit('/me/notices', helper.token, unit.id)).status).toBe(200)
    await built.container.residency.useCases.changeMembership.execute(manager(), id, {
      status: 'removed',
    })
    expect((await errorOf(await asUnit('/me/notices', helper.token, unit.id))).code).toBe(
      'membership_inactive',
    )
  })

  test('RM-05 a unit the account is not in, an unknown unit and a locked membership answer the same 403', async () => {
    const resident = await signIn()
    const stranger = await signIn()
    const unit = await seedUnit()
    await seedMembership(stranger.id, unit.id, 'owner')
    const answers: Array<{ status: number; code: string }> = []
    for (const unitId of [unit.id, crypto.randomUUID()]) {
      const res = await asUnit('/me/notices', resident.token, unitId)
      answers.push({ status: res.status, code: (await errorOf(res)).code })
    }
    expect(answers[0]).toEqual(answers[1])
    expect(answers[0]).toEqual({ status: 403, code: 'membership_inactive' })
  })

  test('a missing or malformed X-Unit-Id is 400 validation_failed, after the token is proven', async () => {
    const resident = await signIn()
    for (const header of [undefined, 'not-a-uuid']) {
      const res = await asUnit('/me/notices', resident.token, header)
      expect(res.status).toBe(400)
      const error = await errorOf(res)
      expect(error.code).toBe('validation_failed')
      expect(JSON.stringify(error.details)).toContain('header.X-Unit-Id')
    }
    expect((await asUnit('/me/notices', undefined, crypto.randomUUID())).status).toBe(401)
  })

  test('RM-07 a helper reaches broadcast notices and is 403 forbidden on fees and member management', async () => {
    const helper = await signIn()
    const unit = await seedUnit()
    await seedMembership(helper.id, unit.id, 'helper')
    expect((await asUnit('/me/notices', helper.token, unit.id)).status).toBe(200)
    for (const path of ['/me/fees', '/me/payments', '/me/members']) {
      const res = await asUnit(path, helper.token, unit.id)
      expect(res.status).toBe(403)
      expect((await errorOf(res)).code).toBe('forbidden')
    }
  })

  test('RM-08 a tenant without can_pay is refused `pay`; after the owner sets it the next request passes', async () => {
    const tenant = await signIn()
    const unit = await seedUnit()
    const id = await seedMembership(tenant.id, unit.id, 'tenant')
    expect((await errorOf(await asUnit('/me/payments', tenant.token, unit.id))).code).toBe(
      'forbidden',
    )
    await built.container.residency.useCases.changeMembership.execute(manager(), id, {
      canPay: true,
    })
    expect((await asUnit('/me/payments', tenant.token, unit.id)).status).toBe(200)
    expect((await errorOf(await asUnit('/me/members', tenant.token, unit.id))).code).toBe(
      'forbidden',
    )
  })

  test('the context carries the start of the membership, for the history filter of DR-40', async () => {
    const owner = await signIn()
    const unit = await seedUnit()
    await seedMembership(owner.id, unit.id, 'owner')
    const [row] =
      await db.sql`SELECT created_at FROM residency.membership WHERE account_id = ${owner.id}`
    const res = await asUnit('/me/fees', owner.token, unit.id)
    expect(await res.json()).toEqual({ startedAt: new Date(row?.created_at).toISOString() })
  })

  test('RM-03 a staff token on a unit route and a resident token on a staff route are both 401', async () => {
    const staff = await call('/auth/staff/login', {
      method: 'POST',
      json: { email: 'admin@sunrise.example', password: PASSWORD, client: 'app' },
    })
    const staffToken = ((await staff.json()) as { accessToken: string }).accessToken
    const resident = await signIn()
    const unit = await seedUnit()
    await seedMembership(resident.id, unit.id, 'owner')
    expect((await asUnit('/me/notices', staffToken, unit.id)).status).toBe(401)
    expect((await call('/staff/settings', { token: resident.token })).status).toBe(401)
  })
})

describe('the terms gate inside the guard, and /me/terms (AD-32, AD-33, DOC-35 §9.3)', () => {
  const admin = (): StaffContext => ({ ...manager(), role: 'admin' })
  const text = (label: string) => ({ vi: `## ${label}\n\nNội dung`, en: `## ${label}\n\nBody` })

  test('a version published refuses the very next unit request with terms_required; /me answers; accepting through POST /me/terms lets it pass', async () => {
    const resident = await signIn()
    const unit = await seedUnit()
    await seedMembership(resident.id, unit.id, 'owner')
    expect((await asUnit('/me/notices', resident.token, unit.id)).status).toBe(200)

    const v1 = await built.container.building.useCases.publishTerms.execute(admin(), {
      kind: 'terms',
      text: text('Terms'),
    })
    const refused = await asUnit('/me/notices', resident.token, unit.id)
    expect(refused.status).toBe(403)
    expect(await errorOf(refused)).toMatchObject({
      code: 'terms_required',
      details: { required: [{ kind: 'terms', version: 1, versionId: v1.id }] },
    })
    expect((await call('/me', { token: resident.token })).status).toBe(200)

    const listed = await call('/me/terms', { token: resident.token })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({
      items: [
        {
          versionId: v1.id,
          kind: 'terms',
          version: 1,
          accepted: false,
          text: '## Terms\n\nNội dung',
        },
      ],
    })
    const english = await call('/me/terms', {
      token: resident.token,
      headers: { 'accept-language': 'en-US' },
    })
    expect(((await english.json()) as { items: Array<{ text: string }> }).items[0]?.text).toBe(
      '## Terms\n\nBody',
    )

    const accepted = await call('/me/terms', {
      method: 'POST',
      token: resident.token,
      json: { versionIds: [v1.id] },
    })
    expect(accepted.status).toBe(204)
    expect((await asUnit('/me/notices', resident.token, unit.id)).status).toBe(200)
    const after = await call('/me/terms', { token: resident.token })
    expect(
      ((await after.json()) as { items: Array<{ accepted: boolean }> }).items[0]?.accepted,
    ).toBe(true)

    const v2 = await built.container.building.useCases.publishTerms.execute(admin(), {
      kind: 'terms',
      text: text('Terms 2'),
    })
    expect((await errorOf(await asUnit('/me/notices', resident.token, unit.id))).code).toBe(
      'terms_required',
    )
    const stale = await call('/me/terms', {
      method: 'POST',
      token: resident.token,
      json: { versionIds: [v1.id] },
    })
    expect(stale.status).toBe(204)
    const superseded = await call('/me/terms', {
      method: 'POST',
      token: resident.token,
      json: { versionIds: [crypto.randomUUID()] },
    })
    expect(superseded.status).toBe(404)
    expect(
      (
        await call('/me/terms', {
          method: 'POST',
          token: resident.token,
          json: { versionIds: [v2.id] },
        })
      ).status,
    ).toBe(204)
  })

  test('an account with no unit has no terms to accept: the list is empty and a POST is 404', async () => {
    const resident = await signIn()
    expect(await (await call('/me/terms', { token: resident.token })).json()).toEqual({ items: [] })
    const res = await call('/me/terms', {
      method: 'POST',
      token: resident.token,
      json: { versionIds: [crypto.randomUUID()] },
    })
    expect(res.status).toBe(404)
    expect((await call('/me/terms')).status).toBe(401)
  })
})

describe('boot guard check 1 with the real ResidencyApi (RM-50, BD-30)', () => {
  test('a flagged demo account with a membership in the real building makes the guard fail', async () => {
    // The accounts above are flagged demo accounts with memberships in the real building, which is exactly what the guard refuses.
    await db.sql`DELETE FROM residency.membership`
    const flagged = await signIn()
    await seedMembership(flagged.id, (await seedUnit(DEMO_BUILDING)).id, 'owner', {
      buildingId: DEMO_BUILDING,
    })
    expect(await runBootGuard(built.container.bootGuard)).toEqual([])
    await seedMembership(flagged.id, (await seedUnit()).id, 'tenant')
    const failures = await runBootGuard(built.container.bootGuard)
    expect(failures).toEqual([expect.objectContaining({ check: 1, ids: [BUILDING] })])
  })
})
