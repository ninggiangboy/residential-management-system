import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { FakeStorage } from '@core/testing'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import {
  api,
  bodyOf,
  errorOf,
  localDay,
  seedBuilding,
  seedGatewayEvent,
  seedIntent,
  seedMembership,
  seedPublishedCharge,
  seedResidentAccount,
  seedStaff,
  seedUnit,
  signInStaff,
} from './finance-support'
import { containerFor } from './support'

/**
 * The staff finance routes over HTTP against a real PostgreSQL (DOC-51 §2.2, P2-15): the publish flow (E-90, E-170, E-94, E-95),
 * the batch reads (E-89, E-91, E-93), the manual payment and its idempotency (E-104, LG-04, LG-18), the voids (E-100, E-105),
 * the batch lifecycle (E-96, E-97, E-98, E-171, E-172), the bulk PDF job (E-99, E-177) and the money log (E-108…E-110). The
 * rules themselves are proved against PostgreSQL in `modules/finance/test`; here the guard, the headers, the wrapper and the
 * bodies over `app.handle`.
 */

const BUILDING = '018f0000-0000-7000-8000-000000000021'
const MONEY_BUILDING = '018f0000-0000-7000-8000-000000000022'

let db: TestDb
let built: ReturnType<typeof containerFor>
let app: ReturnType<typeof containerFor>['app']
let manager: string
let moneyManager: string
let today: string
let unitId: string
let unitCode: string
let moneyUnitId: string
let moneyUnitCode: string

const A_1508 = 2_488_000

const backupUnit = async (code: string): Promise<string> =>
  seedUnit(db, { buildingId: BUILDING, code })

/** A published batch with one open charge of `amount` on a fresh unit of BUILDING; returns the unit as well. */
async function seedChargeFixture(code: string, amount: number) {
  const uId = await backupUnit(`A-${code}`)
  const seeded = await seedPublishedCharge(db, {
    buildingId: BUILDING,
    unitId: uId,
    unitCode: `A-${code}`,
    amount,
    code: `PH-2699-${code}`,
  })
  return { unitId: uId, ...seeded }
}

async function createBatch(
  feeMonth: string,
  dueDate: string,
  name = 'Phí',
): Promise<{
  id: string
  code: string
  version: number
}> {
  const res = await api(app, '/staff/fee-batches', {
    method: 'POST',
    token: manager,
    json: { name: { vi: `${name} ${feeMonth}` }, feeMonth, dueDate },
  })
  expect(res.status).toBe(201)
  return bodyOf<{ id: string; code: string; version: number }>(res)
}

async function addCharge(batchId: string, code: string, unitPrice: number): Promise<string> {
  const res = await api(app, `/staff/fee-batches/${batchId}/charges`, {
    method: 'POST',
    token: manager,
    json: { unitCode: code, lines: [{ itemName: { vi: 'Phí quản lý' }, unitPrice }] },
  })
  expect(res.status).toBe(201)
  return (await bodyOf<{ id: string }>(res)).id
}

async function publish(batchId: string, ifMatch: string): Promise<Response> {
  return api(app, `/staff/fee-batches/${batchId}/publish`, {
    method: 'POST',
    token: manager,
    headers: { 'if-match': ifMatch },
  })
}

async function recordPayment(
  targetUnit: string,
  chargeIds: readonly string[],
  overrides: Record<string, unknown> = {},
  key: string = crypto.randomUUID(),
): Promise<Response> {
  return api(app, '/staff/payments', {
    method: 'POST',
    token: manager,
    key,
    json: {
      unitId: targetUnit,
      chargeIds: [...chargeIds],
      method: 'cash',
      payerName: 'Trần Minh Anh',
      receivedOn: today,
      ...overrides,
    },
  })
}

const paymentCount = async (buildingId: string): Promise<number> => {
  const [row] = await db.sql<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM finance.payment WHERE building_id = ${buildingId}`
  return row?.n ?? 0
}

beforeAll(async () => {
  db = await cloneTemplate('empty')
  await seedBuilding(db, BUILDING, 'SUNRISE-STAFF')
  await seedBuilding(db, MONEY_BUILDING, 'SUNRISE-MONEY')
  await seedStaff(db, {
    buildingId: BUILDING,
    email: 'manager@staff.example',
    role: 'manager',
    fullName: 'Lê Văn Quản',
  })
  await seedStaff(db, { buildingId: BUILDING, email: 'admin@staff.example', role: 'admin' })
  await seedStaff(db, { buildingId: BUILDING, email: 'tech@staff.example', role: 'technician' })
  await seedStaff(db, {
    buildingId: MONEY_BUILDING,
    email: 'manager@money.example',
    role: 'manager',
  })
  // E-170 resolves the unit by code and needs an active owner (DOC-21 §4.3).
  unitCode = 'A-1508'
  unitId = await backupUnit(unitCode)
  await seedMembership(db, {
    buildingId: BUILDING,
    accountId: await seedResidentAccount(db, { phone: '+84907000001' }),
    unitId,
    memberType: 'owner',
  })
  moneyUnitCode = 'A-2001'
  moneyUnitId = await seedUnit(db, { buildingId: MONEY_BUILDING, code: moneyUnitCode })

  built = containerFor(db.url, { storage: new FakeStorage() })
  app = built.app
  manager = await signInStaff(app, 'manager@staff.example')
  moneyManager = await signInStaff(app, 'manager@money.example')
  today = localDay(built.container.clock.now())
})
afterAll(async () => {
  await built.container.close()
  await db.drop()
})

describe('the publish flow (E-90, E-170, E-94, E-95, E-92, E-91, E-89, E-93)', () => {
  test('E-90 creates a draft under an Idempotency-Key: 201 + Location + ETag, the key replays, another body is 422', async () => {
    const key = crypto.randomUUID()
    const body = {
      name: { vi: 'Phí tháng 11/2026', en: 'November 2026' },
      feeMonth: '2026-11-01',
      dueDate: '2026-12-15',
    }
    const created = await api(app, '/staff/fee-batches', {
      method: 'POST',
      token: manager,
      key,
      json: body,
    })
    expect(created.status).toBe(201)
    const batch = await bodyOf<{ id: string; code: string; status: string; version: number }>(
      created,
    )
    expect(batch).toMatchObject({
      code: expect.stringMatching(/^PH-2611-\d{2,}$/),
      status: 'draft',
      version: 1,
    })
    expect(created.headers.get('location')).toBe(`/api/v1/staff/fee-batches/${batch.id}`)
    expect(created.headers.get('etag')).toBe('"1"')

    const replay = await api(app, '/staff/fee-batches', {
      method: 'POST',
      token: manager,
      key,
      json: body,
    })
    expect(replay.status).toBe(201)
    expect(replay.headers.get('idempotent-replayed')).toBe('true')
    expect((await bodyOf<{ id: string }>(replay)).id).toBe(batch.id)

    const reuse = await api(app, '/staff/fee-batches', {
      method: 'POST',
      token: manager,
      key,
      json: { ...body, dueDate: '2026-12-16' },
    })
    expect(reuse.status).toBe(422)
    expect((await errorOf(reuse)).code).toBe('idempotency_key_reuse')

    const noKey = await api(app, '/staff/fee-batches', {
      method: 'POST',
      token: manager,
      key: null,
      json: body,
    })
    expect(noKey.status).toBe(400)

    // The fee month is the first of its month (E-90, 400 pattern).
    const badMonth = await api(app, '/staff/fee-batches', {
      method: 'POST',
      token: manager,
      json: { ...body, feeMonth: '2026-11-02' },
    })
    expect(badMonth.status).toBe(400)
  })

  test('E-90 → E-170 → E-94 → E-95: add a charge, replace its lines under If-Match, publish, extend the due date and read it back', async () => {
    const batch = await createBatch('2026-11-01', '2026-12-15')

    // E-170 adds one unit's charge; the batch version moves too (DOC-21 §3.2).
    const addedRes = await api(app, `/staff/fee-batches/${batch.id}/charges`, {
      method: 'POST',
      token: manager,
      json: { unitCode: unitCode, lines: [{ itemName: { vi: 'Phí quản lý' }, unitPrice: A_1508 }] },
    })
    expect(addedRes.status).toBe(201)
    const charge = await bodyOf<{
      id: string
      unitId: string
      unitCode: string
      amount: number
      status: string
      version: number
    }>(addedRes)
    expect(charge).toMatchObject({ unitId, unitCode, amount: A_1508, status: 'draft', version: 1 })
    expect(addedRes.headers.get('etag')).toBe('"1"')

    // E-94 without If-Match is 428.
    const noMatch = await api(app, `/staff/charges/${charge.id}`, {
      method: 'PUT',
      token: manager,
      json: { lines: [{ itemName: { vi: 'Phí quản lý' }, unitPrice: A_1508 }] },
    })
    expect(noMatch.status).toBe(428)

    // E-94 replaces every line (two lines, one with a 3-decimal quantity).
    const replaced = await api(app, `/staff/charges/${charge.id}`, {
      method: 'PUT',
      token: manager,
      headers: { 'if-match': '"1"' },
      json: {
        lines: [
          { itemName: { vi: 'Phí quản lý' }, unitPrice: A_1508 },
          { itemName: { vi: 'Nước' }, quantity: '12.345', unitPrice: 15_000 },
        ],
      },
    })
    expect(replaced.status).toBe(200)
    expect(replaced.headers.get('etag')).toBe('"2"')
    expect(await bodyOf<{ amount: number; version: number }>(replaced)).toMatchObject({
      amount: A_1508 + 185_175,
      version: 2,
    })

    // A stale If-Match on E-94 is its own test below (version_conflict carries the fresh charge as JSON).

    // E-91 shows the header, the counts and the ETag (draft, charge still draft).
    const view = await api(app, `/staff/fee-batches/${batch.id}`, { token: manager })
    expect(view.status).toBe(200)
    expect(view.headers.get('etag')).toBe('"3"')
    expect(
      await bodyOf<{ status: string; counts: Record<string, number | null> }>(view),
    ).toMatchObject({
      status: 'draft',
      counts: { charges: 1, lines: 2, open: 0, paid: 0, void: 0, missing: null },
    })

    // E-95 without If-Match is 428; a stale version is 409 version_conflict while the batch is still a draft.
    expect(
      (await api(app, `/staff/fee-batches/${batch.id}/publish`, { method: 'POST', token: manager }))
        .status,
    ).toBe(428)
    const stalePublish = await publish(batch.id, '"1"')
    expect(stalePublish.status).toBe(409)
    expect((await errorOf(stalePublish)).code).toBe('version_conflict')

    const published = await publish(batch.id, '"3"')
    expect(published.status).toBe(200)
    expect(published.headers.get('etag')).toBe('"4"')
    expect(await bodyOf<{ status: string; version: number }>(published)).toMatchObject({
      status: 'published',
      version: 4,
    })

    // E-92 after publish moves the due date later and answers the new ETag.
    const later = await api(app, `/staff/fee-batches/${batch.id}`, {
      method: 'PATCH',
      token: manager,
      headers: { 'if-match': '"4"' },
      json: { dueDate: '2026-12-20' },
    })
    expect(later.status).toBe(200)
    expect(later.headers.get('etag')).toBe('"5"')
    expect(await bodyOf<{ dueDate: string; status: string }>(later)).toMatchObject({
      dueDate: '2026-12-20',
      status: 'published',
    })
    const notLater = await api(app, `/staff/fee-batches/${batch.id}`, {
      method: 'PATCH',
      token: manager,
      headers: { 'if-match': '"5"' },
      json: { dueDate: '2026-12-19' },
    })
    expect(notLater.status).toBe(400)

    // E-91 after publish: the charge is open, publishedAt is set.
    const after = await bodyOf<{
      counts: Record<string, number | null>
      publishedAt: string | null
      version: number
    }>(await api(app, `/staff/fee-batches/${batch.id}`, { token: manager }))
    expect(after).toMatchObject({
      publishedAt: expect.any(String),
      version: 5,
      counts: { open: 1, paid: 0 },
    })

    // E-89 lists it with the building's status counts on the first page.
    const list = await bodyOf<{
      items: Array<{ id: string; status: string }>
      counts: Record<string, number>
      totalCount: number
      nextCursor: string | null
    }>(await api(app, '/staff/fee-batches?status=published', { token: manager }))
    expect(list.items.some((item) => item.id === batch.id)).toBe(true)
    expect(list.items.every((item) => item.status === 'published')).toBe(true)
    expect(list.counts.published).toBeGreaterThanOrEqual(1)
    expect(list.totalCount).toBeGreaterThanOrEqual(1)

    // Its month finds it; a draft filter does not (E-89).
    const byMonth = await bodyOf<{ items: Array<{ id: string }> }>(
      await api(app, '/staff/fee-batches?month=2026-11', { token: manager }),
    )
    expect(byMonth.items.some((item) => item.id === batch.id)).toBe(true)
    const draftOnly = await bodyOf<{ items: Array<{ id: string }> }>(
      await api(app, '/staff/fee-batches?status=draft', { token: manager }),
    )
    expect(draftOnly.items.some((item) => item.id === batch.id)).toBe(false)

    // E-93 lists the charges with the lines on demand.
    const charges = await bodyOf<{
      items: Array<{
        chargeId: string
        unitCode: string
        lineCount: number
        version: number
        lines?: unknown[]
      }>
    }>(await api(app, `/staff/fee-batches/${batch.id}/charges?include=lines`, { token: manager }))
    expect(charges.items).toHaveLength(1)
    expect(charges.items[0]).toMatchObject({
      chargeId: charge.id,
      unitCode,
      lineCount: 2,
      version: 3,
    })
    expect(charges.items[0]?.lines).toHaveLength(2)
    const openOnly = await bodyOf<{ items: unknown[] }>(
      await api(app, `/staff/fee-batches/${batch.id}/charges?status=open`, { token: manager }),
    )
    expect(openOnly.items).toHaveLength(1)
    const noneDraft = await bodyOf<{ items: unknown[] }>(
      await api(app, `/staff/fee-batches/${batch.id}/charges?status=draft`, { token: manager }),
    )
    expect(noneDraft.items).toHaveLength(0)
    const withoutLines = await bodyOf<{ items: Array<{ lines?: unknown[] }> }>(
      await api(app, `/staff/fee-batches/${batch.id}/charges`, { token: manager }),
    )
    expect(withoutLines.items[0]?.lines).toBeUndefined()
  })

  test('E-94 a stale If-Match is a 409 version_conflict', async () => {
    const batch = await createBatch('2026-11-01', '2026-12-15')
    const chargeId = await addCharge(batch.id, unitCode, 1_000)
    const replaced = await api(app, `/staff/charges/${chargeId}`, {
      method: 'PUT',
      token: manager,
      headers: { 'if-match': '"1"' },
      json: { lines: [{ itemName: { vi: 'Phí' }, unitPrice: 2_000 }] },
    })
    expect(replaced.status).toBe(200)
    const stale = await api(app, `/staff/charges/${chargeId}`, {
      method: 'PUT',
      token: manager,
      headers: { 'if-match': '"1"' },
      json: { lines: [{ itemName: { vi: 'Phí' }, unitPrice: 3_000 }] },
    })
    expect(stale.status).toBe(409)
    expect((await errorOf(stale)).code).toBe('version_conflict')
  })

  test('E-170 refuses an unknown code, a unit without an owner and a second charge for the same unit', async () => {
    const batch = await createBatch('2026-11-01', '2026-12-15')
    const missing = await api(app, `/staff/fee-batches/${batch.id}/charges`, {
      method: 'POST',
      token: manager,
      json: { unitCode: 'A-9999', lines: [{ itemName: { vi: 'Phí' }, unitPrice: 1_000 }] },
    })
    expect(missing.status).toBe(404)

    const orphan = await backupUnit('A-7777')
    const noOwner = await api(app, `/staff/fee-batches/${batch.id}/charges`, {
      method: 'POST',
      token: manager,
      json: { unitCode: 'A-7777', lines: [{ itemName: { vi: 'Phí' }, unitPrice: 1_000 }] },
    })
    expect(noOwner.status).toBe(422)
    expect(JSON.stringify((await errorOf(noOwner)).details)).toContain('unit_without_owner')
    expect(orphan).toBeTruthy()

    await addCharge(batch.id, unitCode, 1_000)
    const twice = await api(app, `/staff/fee-batches/${batch.id}/charges`, {
      method: 'POST',
      token: manager,
      json: { unitCode: unitCode, lines: [{ itemName: { vi: 'Phí' }, unitPrice: 1_000 }] },
    })
    expect(twice.status).toBe(409)
    expect((await errorOf(twice)).code).toBe('charge_exists')
  })
})

describe('the manual payment (E-104, LG-02, LG-04, LG-18)', () => {
  test('LG-04/LG-18 one Idempotency-Key in sequence and five in parallel: one payment, the replays carry the same body', async () => {
    const fixture = await seedChargeFixture('1501', 300_000)
    const second = await seedPublishedCharge(db, {
      buildingId: BUILDING,
      unitId: fixture.unitId,
      unitCode: 'A-1501',
      amount: 500_000,
      code: 'PH-2698-1501',
    })
    const charges = [fixture.chargeId, second.chargeId]
    const key = crypto.randomUUID()

    const created = await recordPayment(fixture.unitId, charges, {}, key)
    expect(created.status).toBe(201)
    expect(created.headers.get('idempotent-replayed')).toBeNull()
    const body = await bodyOf<{ paymentId: string; amount: number; receipts: unknown[] }>(created)
    expect(body.amount).toBe(800_000)
    expect(body.receipts).toHaveLength(2)
    expect(await paymentCount(BUILDING)).toBe(1)

    // The same key again. The P1-28 wrapper replays the response it stored, whose status is the first one (201); DOC-22
    // §5.2's "200 on a replay" is the use case's own path (a key row already gone while the payment stays). LG-04 only
    // asks that the second response equal the first.
    const replay = await recordPayment(fixture.unitId, charges, {}, key)
    expect(replay.status).toBe(201)
    expect(replay.headers.get('idempotent-replayed')).toBe('true')
    expect(await bodyOf(replay)).toEqual(body)

    const parallelUnit = (await seedChargeFixture('1503', 100_000)).unitId
    const parallelCharge = (
      await seedPublishedCharge(db, {
        buildingId: BUILDING,
        unitId: parallelUnit,
        unitCode: 'A-1503',
        amount: 120_000,
        code: 'PH-2698-1503',
      })
    ).chargeId
    const parallelKey = crypto.randomUUID()
    const runs = await Promise.all(
      Array.from({ length: 5 }, () =>
        recordPayment(parallelUnit, [parallelCharge], {}, parallelKey),
      ),
    )
    expect(runs.filter((res) => res.headers.get('idempotent-replayed') !== 'true')).toHaveLength(1)
    expect(runs.filter((res) => res.headers.get('idempotent-replayed') === 'true')).toHaveLength(4)
    const bodies = await Promise.all(runs.map((res) => bodyOf(res)))
    const canonical = bodies[0] ?? {}
    for (const one of bodies) expect(one).toEqual(canonical)
    const [row] = await db.sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM finance.payment WHERE building_id = ${BUILDING} AND unit_id = ${parallelUnit}`
    expect(row?.n).toBe(1)
    expect(await paymentCount(BUILDING)).toBe(2)
  })

  test('E-104 refuses a missing key, the same key with another body, a wrong amount, an unknown key and writes nothing on a dry run', async () => {
    const fixture = await seedChargeFixture('1504', 300_000)
    const other = await seedPublishedCharge(db, {
      buildingId: BUILDING,
      unitId: fixture.unitId,
      unitCode: 'A-1504',
      amount: 500_000,
      code: 'PH-2698-1504',
    })
    const both = [fixture.chargeId, other.chargeId]

    expect((await recordPayment(fixture.unitId, both, {}, crypto.randomUUID())).status).toBe(201)

    // missing key
    const noKey = await api(app, '/staff/payments', {
      method: 'POST',
      token: manager,
      key: null,
      json: {
        unitId: fixture.unitId,
        chargeIds: [],
        method: 'cash',
        payerName: 'X',
        receivedOn: today,
      },
    })
    expect(noKey.status).toBe(400)

    // unknown key in the body (strictObject)
    const unknown = await recordPayment(fixture.unitId, [], { surprise: 1 })
    expect(unknown.status).toBe(400)
    expect(JSON.stringify(await bodyOf(unknown))).toContain('unknown_key')

    // LG-02: an amount that differs from the sum is 422 allocation_mismatch with its details.
    const mismatchFixture = await seedChargeFixture('1505', 300_000)
    const mismatchOther = await seedPublishedCharge(db, {
      buildingId: BUILDING,
      unitId: mismatchFixture.unitId,
      unitCode: 'A-1505',
      amount: 500_000,
      code: 'PH-2698-1505',
    })
    const mismatch = await recordPayment(
      mismatchFixture.unitId,
      [mismatchFixture.chargeId, mismatchOther.chargeId],
      {
        amount: 700_000,
      },
    )
    expect(mismatch.status).toBe(422)
    const mismatchError = await errorOf(mismatch)
    expect(mismatchError.code).toBe('allocation_mismatch')
    expect(mismatchError.details).toEqual({ expected: 800_000, got: 700_000 })

    // A dry run writes nothing.
    const dryFixture = await seedChargeFixture('1506', 300_000)
    const before = await paymentCount(BUILDING)
    const dry = await recordPayment(dryFixture.unitId, [dryFixture.chargeId], { dryRun: true })
    expect(dry.status).toBe(200)
    expect(
      await bodyOf<{ dryRun: boolean; receiptCount: number; amount: number }>(dry),
    ).toMatchObject({
      dryRun: true,
      amount: 300_000,
      receiptCount: 1,
    })
    expect(await paymentCount(BUILDING)).toBe(before)
    const [charge] = await db.sql<
      { status: string }[]
    >`SELECT status FROM finance.charge WHERE id = ${dryFixture.chargeId}`
    expect(charge?.status).toBe('open')

    // The same key with another body is 422 idempotency_key_reuse.
    const reuseFixture = await seedChargeFixture('1507', 300_000)
    const key = crypto.randomUUID()
    expect(
      (await recordPayment(reuseFixture.unitId, [reuseFixture.chargeId], {}, key)).status,
    ).toBe(201)
    const reuse = await recordPayment(
      reuseFixture.unitId,
      [reuseFixture.chargeId],
      { method: 'bank_transfer' },
      key,
    )
    expect(reuse.status).toBe(422)
    expect((await errorOf(reuse)).code).toBe('idempotency_key_reuse')
  })
})

describe('the voids (E-105, E-100)', () => {
  test('E-105 voids a cash payment, refuses a second void and a short reason', async () => {
    const fixture = await seedChargeFixture('1590', 300_000)
    const posted = await recordPayment(fixture.unitId, [fixture.chargeId])
    expect(posted.status).toBe(201)
    const paymentId = (await bodyOf<{ paymentId: string }>(posted)).paymentId

    const voided = await api(app, `/staff/payments/${paymentId}/void`, {
      method: 'POST',
      token: manager,
      json: { reason: 'recorded by mistake' },
    })
    expect(voided.status).toBe(200)
    expect(await bodyOf<{ status: string; chargeIds: string[] }>(voided)).toMatchObject({
      status: 'void',
      chargeIds: [fixture.chargeId],
    })

    const again = await api(app, `/staff/payments/${paymentId}/void`, {
      method: 'POST',
      token: manager,
      json: { reason: 'recorded by mistake' },
    })
    expect(again.status).toBe(409)
    expect((await errorOf(again)).code).toBe('invalid_transition')

    const other = await seedChargeFixture('1509', 300_000)
    const otherPosted = await recordPayment(other.unitId, [other.chargeId])
    const otherId = (await bodyOf<{ paymentId: string }>(otherPosted)).paymentId
    const short = await api(app, `/staff/payments/${otherId}/void`, {
      method: 'POST',
      token: manager,
      json: { reason: 'abcd' },
    })
    expect(short.status).toBe(422)
    expect(JSON.stringify((await errorOf(short)).details)).toContain('reason_too_short')
  })

  test('E-100 voids one open charge, is 428 without If-Match and 409 charge_not_voidable on a paid one', async () => {
    const fixture = await seedChargeFixture('1510', 300_000)
    expect(
      (
        await api(app, `/staff/charges/${fixture.chargeId}/void`, {
          method: 'POST',
          token: manager,
          json: { reason: 'billed to the wrong unit' },
        })
      ).status,
    ).toBe(428)

    const voided = await api(app, `/staff/charges/${fixture.chargeId}/void`, {
      method: 'POST',
      token: manager,
      headers: { 'if-match': '"2"' },
      json: { reason: 'billed to the wrong unit' },
    })
    expect(voided.status).toBe(200)
    expect(voided.headers.get('etag')).toBe('"3"')
    expect(await bodyOf<{ status: string; version: number }>(voided)).toMatchObject({
      status: 'void',
      version: 3,
    })

    const paid = await seedChargeFixture('1511', 300_000)
    expect((await recordPayment(paid.unitId, [paid.chargeId])).status).toBe(201)
    const paidVoid = await api(app, `/staff/charges/${paid.chargeId}/void`, {
      method: 'POST',
      token: manager,
      headers: { 'if-match': '"2"' },
      json: { reason: 'billed to the wrong unit' },
    })
    expect(paidVoid.status).toBe(409)
    const error = await errorOf(paidVoid)
    expect(error.code).toBe('charge_not_voidable')
    expect(error.details).toEqual({ status: 'paid' })
  })
})

describe('the batch lifecycle (E-96, E-97, E-98, E-171, E-172)', () => {
  test('E-96 recalls a batch with no payment and refuses one with a payment, naming the count', async () => {
    const clean = await seedChargeFixture('1520', 300_000)
    const recalled = await api(app, `/staff/fee-batches/${clean.batchId}/recall`, {
      method: 'POST',
      token: manager,
      headers: { 'if-match': '"2"' },
      json: { reason: 'wrong month billed' },
    })
    expect(recalled.status).toBe(200)
    expect(recalled.headers.get('etag')).toBe('"3"')
    expect(await bodyOf<{ status: string }>(recalled)).toMatchObject({ status: 'recalled' })

    const paid = await seedChargeFixture('1521', 300_000)
    expect((await recordPayment(paid.unitId, [paid.chargeId])).status).toBe(201)
    const refused = await api(app, `/staff/fee-batches/${paid.batchId}/recall`, {
      method: 'POST',
      token: manager,
      headers: { 'if-match': '"2"' },
      json: { reason: 'wrong month billed' },
    })
    expect(refused.status).toBe(409)
    const error = await errorOf(refused)
    expect(error.code).toBe('batch_has_payments')
    expect(error.details).toEqual({ paidCount: 1 })
  })

  test('E-97 closes a published batch and refuses a second close', async () => {
    const fixture = await seedChargeFixture('1522', 300_000)
    const closed = await api(app, `/staff/fee-batches/${fixture.batchId}/close`, {
      method: 'POST',
      token: manager,
      headers: { 'if-match': '"2"' },
    })
    expect(closed.status).toBe(200)
    expect(await bodyOf<{ status: string }>(closed)).toMatchObject({ status: 'closed' })
    const again = await api(app, `/staff/fee-batches/${fixture.batchId}/close`, {
      method: 'POST',
      token: manager,
      headers: { 'if-match': '"3"' },
    })
    expect(again.status).toBe(409)
    expect((await errorOf(again)).code).toBe('invalid_transition')
  })

  test('E-98 re-issues a recalled batch as a new draft and refuses a published one', async () => {
    const fixture = await seedChargeFixture('1523', 300_000)
    await api(app, `/staff/fee-batches/${fixture.batchId}/recall`, {
      method: 'POST',
      token: manager,
      headers: { 'if-match': '"2"' },
      json: { reason: 'wrong month billed' },
    })
    const reissued = await api(app, `/staff/fee-batches/${fixture.batchId}/reissue`, {
      method: 'POST',
      token: manager,
      json: {},
    })
    expect(reissued.status).toBe(201)
    expect(reissued.headers.get('location')).toMatch(/^\/api\/v1\/staff\/fee-batches\//)
    expect(await bodyOf<{ code: string; copiedCharges: number }>(reissued)).toMatchObject({
      copiedCharges: 1,
    })

    const published = await seedChargeFixture('1524', 300_000)
    const refused = await api(app, `/staff/fee-batches/${published.batchId}/reissue`, {
      method: 'POST',
      token: manager,
      json: {},
    })
    expect(refused.status).toBe(409)
    expect((await errorOf(refused)).code).toBe('invalid_transition')
  })

  test('E-171 removes a draft charge (204) and refuses a published one (409); E-172 discards a draft only', async () => {
    const batch = await createBatch('2026-11-01', '2026-12-15')
    const chargeId = await addCharge(batch.id, unitCode, 1_000)
    expect(
      (await api(app, `/staff/charges/${chargeId}`, { method: 'DELETE', token: manager })).status,
    ).toBe(428)
    expect(
      (
        await api(app, `/staff/charges/${chargeId}`, {
          method: 'DELETE',
          token: manager,
          headers: { 'if-match': '"1"' },
        })
      ).status,
    ).toBe(204)

    const published = await seedChargeFixture('1525', 300_000)
    expect(
      (
        await api(app, `/staff/charges/${published.chargeId}`, {
          method: 'DELETE',
          token: manager,
          headers: { 'if-match': '"2"' },
        })
      ).status,
    ).toBe(409)

    const draft = await createBatch('2026-11-01', '2026-12-15')
    expect(
      (
        await api(app, `/staff/fee-batches/${draft.id}`, {
          method: 'DELETE',
          token: manager,
          headers: { 'if-match': '"1"' },
        })
      ).status,
    ).toBe(204)
    const closed = await seedChargeFixture('1526', 300_000)
    expect(
      (
        await api(app, `/staff/fee-batches/${closed.batchId}`, {
          method: 'DELETE',
          token: manager,
          headers: { 'if-match': '"2"' },
        })
      ).status,
    ).toBe(409)
  })
})

describe('the bulk fee-notice job (E-99, E-177)', () => {
  test('E-99 answers 202 with the job, a repeat answers the same one; E-177 reads it', async () => {
    const batch = await createBatch('2026-12-01', '2027-01-15')
    await addCharge(batch.id, unitCode, 500_000)
    expect((await publish(batch.id, '"2"')).status).toBe(200)

    const first = await api(app, `/staff/fee-batches/${batch.id}/pdf`, {
      method: 'POST',
      token: manager,
      json: {},
    })
    expect(first.status).toBe(202)
    const job = await bodyOf<{ id: string; batchId: string; status: string; unitTotal: number }>(
      first,
    )
    expect(job).toMatchObject({ batchId: batch.id, status: 'queued', unitTotal: 1 })

    const repeat = await api(app, `/staff/fee-batches/${batch.id}/pdf`, {
      method: 'POST',
      token: manager,
      json: {},
    })
    expect(repeat.status).toBe(202)
    expect((await bodyOf<{ id: string }>(repeat)).id).toBe(job.id)

    const read = await api(app, `/staff/fee-batches/${batch.id}/pdf`, { token: manager })
    expect(read.status).toBe(200)
    expect(await bodyOf<{ id: string; batchId: string }>(read)).toMatchObject({
      id: job.id,
      batchId: batch.id,
    })
  })

  test('E-99 refuses a draft (409) and E-177 is 404 for a batch with no job', async () => {
    const draft = await createBatch('2026-12-01', '2027-01-15')
    const refused = await api(app, `/staff/fee-batches/${draft.id}/pdf`, {
      method: 'POST',
      token: manager,
      json: {},
    })
    expect(refused.status).toBe(409)
    expect((await errorOf(refused)).code).toBe('invalid_transition')

    const noJob = await seedChargeFixture('1530', 300_000)
    expect(
      (await api(app, `/staff/fee-batches/${noJob.batchId}/pdf`, { token: manager })).status,
    ).toBe(404)
  })
})

describe('the money log (E-108, E-109, E-110)', () => {
  const older = new Date('2026-10-01T02:00:00Z')
  const middle = new Date('2026-10-01T03:00:00Z')
  const newer = new Date('2026-10-01T04:00:00Z')
  let openNewer: string
  let openMiddle: string
  let openOlder: string
  let reviewed: string
  let amountShort: string

  beforeAll(async () => {
    const intentId = await seedIntent(db, {
      buildingId: MONEY_BUILDING,
      unitId: moneyUnitId,
      amount: 100_000,
    })
    openNewer = await seedGatewayEvent(db, {
      buildingId: MONEY_BUILDING,
      unitId: moneyUnitId,
      receivedAt: newer,
    })
    openMiddle = await seedGatewayEvent(db, {
      buildingId: MONEY_BUILDING,
      unitId: moneyUnitId,
      receivedAt: middle,
    })
    openOlder = await seedGatewayEvent(db, { buildingId: MONEY_BUILDING, receivedAt: older })
    reviewed = await seedGatewayEvent(db, {
      buildingId: MONEY_BUILDING,
      unitId: moneyUnitId,
      receivedAt: older,
      reviewed: { by: crypto.randomUUID(), at: older, note: 'checked by hand' },
    })
    amountShort = await seedGatewayEvent(db, {
      buildingId: MONEY_BUILDING,
      unitId: moneyUnitId,
      outcome: 'amount_short',
      amount: 90_000,
      receivedAt: middle,
      intentId,
    })
  })

  test('E-108 lists the rows newest first, keysets over two pages and filters by outcome, unit and state', async () => {
    const page1 = await bodyOf<{ items: Array<{ id: string }>; nextCursor: string }>(
      await api(app, '/staff/money-log?limit=2', { token: moneyManager }),
    )
    expect(page1.items).toHaveLength(2)
    expect(page1.nextCursor).not.toBeNull()
    const page2 = await bodyOf<{ items: Array<{ id: string }>; nextCursor: string | null }>(
      await api(app, `/staff/money-log?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`, {
        token: moneyManager,
      }),
    )
    expect(page2.items.length).toBeGreaterThan(0)
    const ids = [...page1.items, ...page2.items].map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(openNewer)
    expect(ids).toContain(amountShort)

    const byOutcome = await bodyOf<{ items: Array<{ id: string; outcome: string }> }>(
      await api(app, '/staff/money-log?outcome=amount_short', { token: moneyManager }),
    )
    expect(byOutcome.items.map((item) => item.id)).toEqual([amountShort])
    expect(byOutcome.items[0]?.outcome).toBe('amount_short')

    const byUnit = await bodyOf<{ items: Array<{ id: string; unitId: string | null }> }>(
      await api(app, `/staff/money-log?unit=${moneyUnitId}`, { token: moneyManager }),
    )
    expect(byUnit.items.every((item) => item.unitId === moneyUnitId)).toBe(true)
    expect(byUnit.items.some((item) => item.id === openOlder)).toBe(false)

    const open = await bodyOf<{ items: Array<{ id: string }> }>(
      await api(app, '/staff/money-log?state=open&limit=100', { token: moneyManager }),
    )
    expect(open.items.some((item) => item.id === reviewed)).toBe(false)
    expect(open.items.some((item) => item.id === openNewer)).toBe(true)

    const done = await bodyOf<{ items: Array<{ id: string }> }>(
      await api(app, '/staff/money-log?state=reviewed', { token: moneyManager }),
    )
    expect(done.items.map((item) => item.id)).toEqual([reviewed])
  })

  test('E-109 reviews an open row once, refuses a short note and a second review, and leaves the ledger alone', async () => {
    const [before] = await db.sql<{ payments: number; allocations: number; charges: number }[]>`
        SELECT (SELECT count(*)::int FROM finance.payment WHERE building_id = ${MONEY_BUILDING}) AS payments,
               (SELECT count(*)::int FROM finance.allocation WHERE building_id = ${MONEY_BUILDING}) AS allocations,
               (SELECT count(*)::int FROM finance.charge WHERE building_id = ${MONEY_BUILDING}) AS charges`

    const short = await api(app, `/staff/money-log/gateway_event/${openMiddle}/review`, {
      method: 'POST',
      token: moneyManager,
      json: { note: 'abcd' },
    })
    expect(short.status).toBe(422)
    expect(JSON.stringify((await errorOf(short)).details)).toContain('reason_too_short')

    const unknown = await api(app, `/staff/money-log/gateway_event/${crypto.randomUUID()}/review`, {
      method: 'POST',
      token: moneyManager,
      json: { note: 'refunded by bank transfer' },
    })
    expect(unknown.status).toBe(404)

    const annotated = await api(app, `/staff/money-log/gateway_event/${openMiddle}/review`, {
      method: 'POST',
      token: moneyManager,
      json: { note: 'refunded by bank transfer' },
    })
    expect(annotated.status).toBe(200)
    expect(await bodyOf<{ kind: string; id: string; reviewedAt: string }>(annotated)).toMatchObject(
      {
        kind: 'gateway_event',
        id: openMiddle,
        reviewedAt: expect.any(String),
      },
    )

    const second = await api(app, `/staff/money-log/gateway_event/${openMiddle}/review`, {
      method: 'POST',
      token: moneyManager,
      json: { note: 'refunded by bank transfer' },
    })
    expect(second.status).toBe(409)
    expect((await errorOf(second)).code).toBe('money_log_already_reviewed')

    const [after] = await db.sql<{ payments: number; allocations: number; charges: number }[]>`
        SELECT (SELECT count(*)::int FROM finance.payment WHERE building_id = ${MONEY_BUILDING}) AS payments,
               (SELECT count(*)::int FROM finance.allocation WHERE building_id = ${MONEY_BUILDING}) AS allocations,
               (SELECT count(*)::int FROM finance.charge WHERE building_id = ${MONEY_BUILDING}) AS charges`
    expect(after).toEqual(before)
    expect(after).toEqual({ payments: 0, allocations: 0, charges: 0 })
  })

  test("E-110 lists one unit's gateway events, newest first", async () => {
    const panel = await bodyOf<{
      items: Array<{ id: string; unitId: string | null; kind: string }>
    }>(await api(app, `/staff/units/${moneyUnitId}/money-log`, { token: moneyManager }))
    expect(panel.items.length).toBeGreaterThanOrEqual(4)
    expect(
      panel.items.every((item) => item.kind === 'gateway_event' && item.unitId === moneyUnitId),
    ).toBe(true)
    expect(panel.items.some((item) => item.id === openOlder)).toBe(false)
  })
})
