import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { NotFoundError } from '@core/kernel'
import type { BuildingId, DemoPlan } from '@rms/shared-types'
import { createHarness, type Harness } from './support'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

const DEMO = '018f0d01-0000-7000-8000-000000000001' as BuildingId
const REAL = '018f0000-0000-7000-8000-000000000001' as BuildingId
const PASSWORD = 'demo-password-1'

const plan: DemoPlan = {
  building: {} as DemoPlan['building'],
  gateway: {} as DemoPlan['gateway'],
  terms: [],
  termsPublisherId: '018f0d04-0000-7000-8000-000000000001',
  units: [],
  staff: [
    {
      id: '018f0d04-0000-7000-8000-000000000001',
      email: 'admin@demo.rms.invalid',
      fullName: 'Quản trị Demo',
      role: 'admin',
    },
    {
      id: '018f0d04-0000-7000-8000-000000000002',
      email: 'manager@demo.rms.invalid',
      fullName: 'Quản lý Demo',
      role: 'manager',
    },
  ],
  residents: [
    {
      id: '018f0d05-0000-7000-8000-000000000001',
      phone: '+12025550101',
      displayName: 'Demo Owner',
      memberships: [],
    },
    {
      id: '018f0d05-0000-7000-8000-000000000002',
      phone: '+12025550102',
      displayName: 'Demo Family',
      memberships: [],
    },
  ],
}
const ctx = { today: '2026-10-20' as never, plan, password: PASSWORD }

const count = async (table: string, where = 'true') =>
  Number((await h.db.sql.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0]?.n)

describe('identity in the demo reset (DOC-36 §9.1, §10.2)', () => {
  test('BD-37 resetDemo and seedDemo of a building that is not a demo building refuse and change nothing', async () => {
    const staff = await h.seedStaff({ buildingId: REAL })
    const resident = await h.seedResident({ isDemo: true })
    const before = [await count('identity.staff_account'), await count('identity.resident_account')]
    for (const buildingId of [REAL, crypto.randomUUID()]) {
      await expect(h.identity.demo.resetDemo(buildingId)).rejects.toBeInstanceOf(NotFoundError)
      await expect(h.identity.demo.seedDemo(buildingId, ctx)).rejects.toBeInstanceOf(NotFoundError)
    }
    expect([
      await count('identity.staff_account'),
      await count('identity.resident_account'),
    ]).toEqual(before)
    expect(await h.row(staff.id)).toMatchObject({ status: 'active' })
    expect(await count('identity.resident_account', `id = '${resident.id}'`)).toBe(1)
    // A flagged account is the demo's: take it away so the reset below finds only the seed's.
    await h.admin`DELETE FROM identity.resident_account WHERE id = ${resident.id}`
  })

  test('the seed creates active staff who sign in with the demo password, and flagged residents', async () => {
    h.demoBuildings.add(DEMO)
    const created = await h.identity.demo.seedDemo(DEMO, ctx)
    expect(created).toEqual({ 'identity.staff_account': 2, 'identity.resident_account': 2 })

    const session = await h.signIn('admin@demo.rms.invalid', PASSWORD)
    expect(session.staff).toMatchObject({ role: 'admin' })
    expect(
      await count('identity.resident_account', `is_demo AND status = 'active'`),
    ).toBeGreaterThanOrEqual(2)
  })

  test('BD-32 a demo resident signs in with the fixed code and no SMS is sent', async () => {
    const texts = h.texts.length
    const requested = await h.requestOtp('+12025550101')
    const answer = await h.verifyOtp(requested.challengeId, '123456')
    expect(answer.session.accessToken).toBeString()
    expect((await h.deliverSms()).filter((sms) => sms.to === '+12025550101')).toEqual([])
    expect(h.texts.length).toBe(texts)
  })

  test('BD-38 a reset ends every demo session and brings the accounts back with the same ids', async () => {
    // Two sessions exist: the staff member of the seed (above) and the demo resident.
    expect(
      await count(
        'identity.refresh_family',
        `account_id IN ('${plan.staff[0]?.id}', '${plan.residents[0]?.id}')`,
      ),
    ).toBe(2)
    const other = await h.seedStaff({ buildingId: REAL })
    const otherSession = await h.signIn(other.email, other.password ?? '')
    const real = await h.seedResident({ isDemo: false })
    const phones = plan.residents.map((resident) => resident.phone)

    const deleted = await h.identity.demo.resetDemo(DEMO)
    expect(deleted).toEqual({
      'identity.refresh_family': 2,
      'identity.password_token': 0,
      'identity.staff_account': 2,
      'identity.otp_challenge': 1,
      'identity.resident_account': 2,
    })
    expect(await count('identity.staff_account', `building_id = '${DEMO}'`)).toBe(0)
    expect(
      await count(
        'identity.refresh_token',
        `family_id IN (SELECT id FROM identity.refresh_family WHERE account_id IN ('${plan.staff[0]?.id}', '${plan.residents[0]?.id}'))`,
      ),
    ).toBe(0)
    expect(await count('identity.otp_challenge', `phone IN ('${phones.join("','")}')`)).toBe(0)
    // What is not the demo's is not touched.
    expect(await h.row(other.id)).toMatchObject({ status: 'active' })
    expect(await count('identity.refresh_family', `account_id = '${other.id}'`)).toBe(1)
    expect(otherSession.session.accessToken).toBeString()
    expect(await count('identity.resident_account', `id = '${real.id}'`)).toBe(1)

    await h.identity.demo.seedDemo(DEMO, ctx)
    expect(
      await count(
        'identity.staff_account',
        `id = '${plan.staff[1]?.id}' AND email = 'manager@demo.rms.invalid'`,
      ),
    ).toBe(1)
    expect(
      await count('identity.resident_account', `id = '${plan.residents[1]?.id}' AND is_demo`),
    ).toBe(1)
  })

  test('the module is called "identity" and the seed password is hashed with the configured parameters, once for all staff', async () => {
    expect(h.identity.demo.module).toBe('identity')
    const hashes = await h.db
      .sql`SELECT DISTINCT password_hash FROM identity.staff_account WHERE building_id = ${DEMO}`
    expect(hashes).toHaveLength(1)
    expect(String(hashes[0]?.password_hash)).toStartWith('$argon2id$')
  })
})

describe('what the demo sends (DOC-36 §9.2)', () => {
  test('BD-35 a mail command for the Admin of a demo building reaches no mailer and is done', async () => {
    h.demoBuildings.add(DEMO)
    const admin = await h.seedStaff({ role: 'admin', buildingId: DEMO })
    await h.deliverMail() // what the tests before left in the outbox
    await h.identity.useCases.requestStepUp.execute(admin.context, 'admin_change')
    expect(await h.deliverMail()).toEqual([])
    const pending = await h.db
      .sql`SELECT count(*)::int AS n FROM identity.outbox_messages WHERE type = 'identity.mail_requested.v1' AND published_at IS NULL`
    expect(Number(pending[0]?.n)).toBe(0)
    expect(h.metrics.count('mail_sent_total', { outcome: 'skipped_demo' })).toBe(1)
  })

  test('the same command for the Admin of a real building is sent', async () => {
    const admin = await h.seedStaff({ role: 'admin', buildingId: REAL })
    await h.identity.useCases.requestStepUp.execute(admin.context, 'admin_change')
    expect((await h.deliverMail()).map((mail) => mail.to)).toEqual([admin.email])
  })

  test('BD-34 an SMS command queued for an account that is a demo account by the time it is sent reaches no provider and is done', async () => {
    const resident = await h.seedResident()
    await h.requestOtp(resident.phone)
    await h.admin`UPDATE identity.resident_account SET is_demo = true WHERE id = ${resident.id}`
    const before = h.texts.length
    expect(await h.deliverSms()).toEqual([])
    expect(h.texts.length).toBe(before)
    expect(h.metrics.count('sms_sent_total', { outcome: 'skipped_demo' })).toBe(1)
  })
})
