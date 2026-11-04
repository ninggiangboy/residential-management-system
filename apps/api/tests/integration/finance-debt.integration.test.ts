import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { FakeStorage } from '@core/testing'
import { PdfRenderFailure } from '@mod/finance'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import {
  api,
  bodyOf,
  errorOf,
  localDay,
  nextPhone,
  seedBuilding,
  seedMembership,
  seedPublishedCharge,
  seedResident,
  seedResidentAccount,
  seedStaff,
  seedUnit,
  signInResident,
  signInStaff,
} from './finance-support'
import { containerFor } from './support'

/**
 * The debt routes over HTTP against a real PostgreSQL (DOC-51 §2.2, DOC-22 §8, DOC-66 §5; P2-15): the E-101 debt list with its
 * filters, its first-page tiles and its keyset; the E-102 unit view with its payments page; the E-103 reminders with the required
 * `Idempotency-Key`, the body rules, the once-a-day rule (LG-38…LG-39) and the per-account bucket (LG-40). The reads themselves
 * are proved against PostgreSQL in `modules/finance/test`; here the guard, the headers, the wrapper and the bodies over
 * `app.handle`.
 */

const BUILDING = '018f0000-0000-7000-8000-000000000071'
const OTHER_BUILDING = '018f0000-0000-7000-8000-000000000072'

const OWNER_A = 'Trần Minh Anh'
const OWNER_B = 'Lê Văn B'

/** Unit A owes A1 (40 days past due, over the 30-day switch) and paid A2 through the API. */
const A1 = 3_000_000
const A2 = 500_000
/** Unit B owes B1 (10 days past due, under the switch). */
const B1 = 2_000_000
/** Unit C owes C1, not yet due. */
const C1 = 1_000_000

const MONTH_A = '2026-08-01'
const MONTH_B = '2026-09-01'
const MONTH_C = '2026-10-01'

let db: TestDb
let admin: ReturnType<TestDb['admin']>
let built: ReturnType<typeof containerFor>
let app: ReturnType<typeof containerFor>['app']
let manager: string
let rateManager: string
let technician: string
let guard: string
let resident: string
let today: string
let unitA: string
let unitB: string
let unitC: string
let unitEmpty: string
let otherUnit: string
let chargeA1: string
let chargeA2: string

/** `YYYY-MM-DD` shifted by whole days, on the calendar (the building day of `seedPublishedCharge`). */
function dayShift(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** An active owner profile and membership, so E-101/E-102 read an `ownerName` (DOC-66 §5, DR-292). */
async function seedOwner(unitId: string, fullName: string): Promise<void> {
  const accountId = await seedResidentAccount(db, { phone: nextPhone() })
  await admin`
    INSERT INTO residency.resident_profile (building_id, account_id, full_name)
    VALUES (${BUILDING}::uuid, ${accountId}::uuid, ${fullName})`
  await seedMembership(db, { buildingId: BUILDING, accountId, unitId, memberType: 'owner' })
}

/** A `posted` cash payment straight in the table: the older rows E-102 keysets over (the newest is the API's, with its receipt). */
async function insertCashPayment(unitId: string, receivedAt: Date, amount: number): Promise<void> {
  await admin`
    INSERT INTO finance.payment
      (id, building_id, unit_id, source, amount, received_at, payer_name, client_key, recorded_by, status)
    VALUES (${crypto.randomUUID()}::uuid, ${BUILDING}::uuid, ${unitId}::uuid, 'cash', ${amount}, ${receivedAt},
            ${OWNER_A}, ${crypto.randomUUID()}::uuid, ${crypto.randomUUID()}::uuid, 'posted')`
}

beforeAll(async () => {
  db = await cloneTemplate('empty')
  admin = db.admin()
  await seedBuilding(db, BUILDING, 'SUNRISE-DEBT')
  await seedBuilding(db, OTHER_BUILDING, 'SUNRISE-OTHER')
  await seedStaff(db, {
    buildingId: BUILDING,
    email: 'manager@debt.example',
    role: 'manager',
    fullName: 'Lê Văn Quản',
  })
  // A second Manager: the reminder bucket is per account, so this one starts with a fresh ten (LG-40).
  await seedStaff(db, { buildingId: BUILDING, email: 'rate@debt.example', role: 'manager' })
  await seedStaff(db, { buildingId: BUILDING, email: 'admin@debt.example', role: 'admin' })
  await seedStaff(db, { buildingId: BUILDING, email: 'tech@debt.example', role: 'technician' })
  await seedStaff(db, { buildingId: BUILDING, email: 'guard@debt.example', role: 'guard' })

  unitA = await seedUnit(db, { buildingId: BUILDING, code: 'A-1501' })
  unitB = await seedUnit(db, { buildingId: BUILDING, code: 'A-1502' })
  unitC = await seedUnit(db, { buildingId: BUILDING, code: 'A-1503' })
  unitEmpty = await seedUnit(db, { buildingId: BUILDING, code: 'D-1' })
  otherUnit = await seedUnit(db, { buildingId: OTHER_BUILDING, code: 'Z-9001' })

  built = containerFor(db.url, { storage: new FakeStorage() })
  app = built.app
  today = localDay(built.container.clock.now())

  await seedOwner(unitA, OWNER_A)
  await seedOwner(unitB, OWNER_B)

  // A: 40 days past due (over the switch). B: 10 days. C: not yet due. The debt list orders them A, B, C by outstanding.
  chargeA1 = (
    await seedPublishedCharge(db, {
      buildingId: BUILDING,
      unitId: unitA,
      unitCode: 'A-1501',
      amount: A1,
      code: 'PH-2608-01',
      feeMonth: MONTH_A,
      dueDate: dayShift(today, -40),
    })
  ).chargeId
  // A second charge on A, paid through the API, so E-102 shows a payment with a receipt but A still owes A1.
  chargeA2 = (
    await seedPublishedCharge(db, {
      buildingId: BUILDING,
      unitId: unitA,
      unitCode: 'A-1501',
      amount: A2,
      code: 'PH-2609-01',
      feeMonth: MONTH_B,
      dueDate: dayShift(today, -5),
    })
  ).chargeId
  await seedPublishedCharge(db, {
    buildingId: BUILDING,
    unitId: unitB,
    unitCode: 'A-1502',
    amount: B1,
    code: 'PH-2609-02',
    feeMonth: MONTH_B,
    dueDate: dayShift(today, -10),
  })
  await seedPublishedCharge(db, {
    buildingId: BUILDING,
    unitId: unitC,
    unitCode: 'A-1503',
    amount: C1,
    code: 'PH-2610-01',
    feeMonth: MONTH_C,
    dueDate: dayShift(today, 20),
  })
  // Another building's unit, with a debt of its own: E-102 must keep it out of the token's building (DR-324).
  await seedPublishedCharge(db, {
    buildingId: OTHER_BUILDING,
    unitId: otherUnit,
    unitCode: 'Z-9001',
    amount: A1,
    code: 'PH-2609-09',
    feeMonth: MONTH_B,
    dueDate: dayShift(today, -40),
  })

  manager = await signInStaff(app, 'manager@debt.example')
  rateManager = await signInStaff(app, 'rate@debt.example')
  technician = await signInStaff(app, 'tech@debt.example')
  guard = await signInStaff(app, 'guard@debt.example')
  const home = await seedResident(db, {
    buildingId: BUILDING,
    unitId: unitEmpty,
    memberType: 'owner',
  })
  resident = await signInResident(app, home.phone)

  const paid = await api(app, '/staff/payments', {
    method: 'POST',
    token: manager,
    key: crypto.randomUUID(),
    json: {
      unitId: unitA,
      chargeIds: [chargeA2],
      method: 'cash',
      payerName: OWNER_A,
      receivedOn: today,
    },
  })
  if (paid.status !== 201) throw new Error(`seeding the payment answered ${paid.status}`)
  // 20 older payments, so E-102's page of 20 has a next page of one.
  for (let index = 1; index <= 20; index += 1)
    await insertCashPayment(unitA, new Date(Date.now() - index * 3_600_000), 50_000 + index)
})
afterAll(async () => {
  await admin.end()
  await built.container.close()
  await db.drop()
})

interface DebtRowBody {
  readonly unitId: string
  readonly unitCode: string
  readonly ownerName: string | null
  readonly outstanding: number
  readonly openCharges: number
  readonly overdue30: number
}
interface DebtListBody {
  readonly items: readonly DebtRowBody[]
  readonly nextCursor: string | null
  readonly summary?: {
    readonly outstanding: number
    readonly units: number
    readonly ownedUnits: number | null
    readonly overdue30: { readonly amount: number; readonly units: number }
  }
  readonly asOf?: string
}

const listDebts = async (query = ''): Promise<DebtListBody> =>
  bodyOf<DebtListBody>(await api(app, `/staff/debts${query}`, { token: manager }))

describe('E-101 the debt list (DOC-66 §5, DOC-22 §8.2)', () => {
  test('lists the units that owe, the largest debt first, with the owner names, the tiles and asOf', async () => {
    const res = await api(app, '/staff/debts', { token: manager })
    expect(res.status).toBe(200)
    const body = await listDebts()

    expect(body.items.map((row) => row.unitId)).toEqual([unitA, unitB, unitC])
    expect(body.items.map((row) => row.outstanding)).toEqual([A1, B1, C1])
    expect(body.items[0]).toMatchObject({
      unitCode: 'A-1501',
      ownerName: OWNER_A,
      openCharges: 1,
      overdue30: A1,
    })
    expect(body.items[1]?.ownerName).toBe(OWNER_B)
    // A unit with no active owner keeps `null` (DOC-66 §5).
    expect(body.items[2]?.ownerName).toBeNull()

    expect(body.summary).toMatchObject({
      outstanding: A1 + B1 + C1,
      units: 3,
      ownedUnits: null,
      overdue30: { amount: A1, units: 1 },
    })
    expect(body.asOf).toBe(today)
    expect(body.nextCursor).toBeNull()
  })

  test('the month, q and overdue=30 filters narrow the list (DOC-66 §5)', async () => {
    const month = await listDebts(`?month=${MONTH_B.slice(0, 7)}`)
    expect(month.items.map((row) => row.unitId)).toEqual([unitB])

    const search = await listDebts('?q=1502')
    expect(search.items.map((row) => row.unitCode)).toEqual(['A-1502'])

    const overdue = await listDebts('?overdue=30')
    expect(overdue.items.map((row) => row.unitId)).toEqual([unitA])
    expect(overdue.summary?.overdue30).toEqual({ amount: A1, units: 1 })
  })

  test('keysets over three pages with limit=1, the tiles only on the first page, no duplicate rows (DOC-22 §8.2)', async () => {
    const first = await listDebts('?limit=1')
    expect(first.items.map((row) => row.unitId)).toEqual([unitA])
    expect(first.nextCursor).not.toBeNull()
    expect('summary' in first).toBe(true)
    expect('asOf' in first).toBe(true)

    const second = await listDebts(
      `?limit=1&cursor=${encodeURIComponent(first.nextCursor as string)}`,
    )
    expect(second.items.map((row) => row.unitId)).toEqual([unitB])
    expect(second.nextCursor).not.toBeNull()
    expect('summary' in second).toBe(false)
    expect('asOf' in second).toBe(false)

    const third = await listDebts(
      `?limit=1&cursor=${encodeURIComponent(second.nextCursor as string)}`,
    )
    expect(third.items.map((row) => row.unitId)).toEqual([unitC])
    expect(third.nextCursor).toBeNull()
    expect('summary' in third).toBe(false)

    const seen = [...first.items, ...second.items, ...third.items].map((row) => row.unitId)
    expect(new Set(seen).size).toBe(3)
  })

  test('a Technician, a Guard and a resident token are refused on E-101, E-102 and E-103 (DOC-39 §4)', async () => {
    const reminder = { method: 'POST' as const, json: { unitIds: [unitA] } }
    const paths: ReadonlyArray<readonly [string, RequestInit]> = [
      ['/staff/debts', {}],
      [`/staff/units/${unitA}/debt`, {}],
      ['/staff/debts/reminders', reminder],
    ]
    for (const token of [technician, guard]) {
      for (const [path, init] of paths) {
        const res = await api(app, path, { ...init, token })
        expect({ path, status: res.status }).toEqual({ path, status: 403 })
      }
    }
    for (const [path, init] of paths) {
      const res = await api(app, path, { ...init, token: resident })
      expect([401, 403]).toContain(res.status)
    }
  })
})

describe('E-102 the debt of one unit (DOC-66 §5)', () => {
  test('shows the unit, the owner, the tiles, the open charge and a payments page with a receipt and a cursor', async () => {
    const res = await api(app, `/staff/units/${unitA}/debt`, { token: manager })
    expect(res.status).toBe(200)
    const body = await bodyOf<{
      unit: { id: string; code: string; floor: number | null; areaM2: string | null }
      owner: { name: string | null; phone: string | null }
      summary: {
        outstanding: number
        openCharges: number
        nearestDue: string | null
        overdueAmount: number
      }
      openCharges: Array<{
        chargeId: string
        batch: { code: string }
        amount: number
        dueDate: string
        daysPastDue: number
        version: number
        activeIntent: unknown
      }>
      payments: Array<{
        paymentId: string
        source: string
        amount: number
        receivedAt: string
        receipts: Array<{ id: string; number: string; chargeId: string; status: string }>
      }>
      nextCursor: string | null
    }>(res)

    expect(body.unit).toEqual({ id: unitA, code: 'A-1501', floor: 15, areaM2: null })
    expect(body.owner).toEqual({ name: OWNER_A, phone: null })
    expect(body.summary).toEqual({
      outstanding: A1,
      openCharges: 1,
      nearestDue: dayShift(today, -40),
      overdueAmount: A1,
    })
    expect(body.openCharges).toHaveLength(1)
    expect(body.openCharges[0]).toMatchObject({
      chargeId: chargeA1,
      batch: { code: 'PH-2608-01' },
      amount: A1,
      version: 2,
      activeIntent: null,
    })

    expect(body.payments).toHaveLength(20)
    expect(body.payments[0]?.receipts).toHaveLength(1)
    expect(body.payments[0]?.receipts[0]).toMatchObject({
      chargeId: chargeA2,
      status: 'issued',
      number: expect.any(String),
    })
    expect(body.nextCursor).not.toBeNull()

    const second = await bodyOf<{ payments: unknown[]; nextCursor: string | null }>(
      await api(
        app,
        `/staff/units/${unitA}/debt?paymentsCursor=${encodeURIComponent(body.nextCursor as string)}`,
        { token: manager },
      ),
    )
    expect(second.payments).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
  })

  test("an unknown unit and another building's unit are 404 (DOC-66 §6, DR-324)", async () => {
    expect(
      (await api(app, `/staff/units/${crypto.randomUUID()}/debt`, { token: manager })).status,
    ).toBe(404)
    expect((await api(app, `/staff/units/${otherUnit}/debt`, { token: manager })).status).toBe(404)
  })
})

describe('E-103 the reminders (DOC-22 §8.5, LG-38…LG-40)', () => {
  const reminderCount = async (unitId: string): Promise<number> => {
    const [row] = await db.sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM finance.debt_reminder WHERE building_id = ${BUILDING} AND unit_id = ${unitId}`
    return row?.n ?? 0
  }

  const remind = (
    token: string,
    unitIds: readonly string[],
    key?: string | null,
  ): Promise<Response> =>
    api(app, '/staff/debts/reminders', {
      method: 'POST',
      token,
      key,
      json: { unitIds: [...unitIds] },
    })

  /** The rule code of a `validation_failed` body (`RequestRuleError` is a `ValidationError`, DOC-42 §5.2). */
  const ruleOf = async (res: Response): Promise<string | undefined> => {
    const { details } = await errorOf(res)
    return (details as Array<{ code: string }> | undefined)?.[0]?.code
  }

  test('needs an Idempotency-Key, refuses none and more than 500 units, and reminds a unit that owes once', async () => {
    const noKey = await remind(manager, [unitA], null)
    expect(noKey.status).toBe(400)

    const none = await remind(manager, [])
    expect(none.status).toBe(400)
    expect(await ruleOf(none)).toBe('no_unit_selected')

    const many = await remind(
      manager,
      Array.from({ length: 501 }, () => crypto.randomUUID()),
    )
    expect(many.status).toBe(400)
    expect(await ruleOf(many)).toBe('too_many_units')

    const sent = await remind(manager, [unitA])
    expect(sent.status).toBe(200)
    expect(await bodyOf(sent)).toEqual({ sent: 1, alreadyRemindedToday: 0, noDebt: 0 })
  })

  test('the same unit on the same building day is alreadyRemindedToday, a unit with no debt is noDebt', async () => {
    const again = await remind(manager, [unitA])
    expect(again.status).toBe(200)
    expect(await bodyOf(again)).toEqual({ sent: 0, alreadyRemindedToday: 1, noDebt: 0 })

    const none = await remind(manager, [unitEmpty])
    expect(none.status).toBe(200)
    expect(await bodyOf(none)).toEqual({ sent: 0, alreadyRemindedToday: 0, noDebt: 1 })
  })

  test('the same key and body replays the stored answer and writes one reminder row', async () => {
    const key = crypto.randomUUID()
    const first = await remind(manager, [unitB], key)
    expect(first.status).toBe(200)
    expect(await bodyOf(first)).toEqual({ sent: 1, alreadyRemindedToday: 0, noDebt: 0 })
    expect(await reminderCount(unitB)).toBe(1)

    const replay = await remind(manager, [unitB], key)
    expect(replay.status).toBe(200)
    expect(replay.headers.get('idempotent-replayed')).toBe('true')
    expect(await bodyOf(replay)).toEqual({ sent: 1, alreadyRemindedToday: 0, noDebt: 0 })
    expect(await reminderCount(unitB)).toBe(1)
  })

  test('LG-40 the eleventh request of one account within the hour is 429 with Retry-After; another account still passes', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const res = await remind(rateManager, [unitC])
      expect({ attempt, status: res.status }).toEqual({ attempt, status: 200 })
    }
    const limited = await remind(rateManager, [unitC])
    expect(limited.status).toBe(429)
    expect((await errorOf(limited)).code).toBe('rate_limited')
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)

    // The bucket is the account's, not the building's: the other Manager is still served (DOC-22 §8.5).
    const other = await remind(manager, [unitC])
    expect(other.status).toBe(200)
  })
})

describe('PD-26 the renderer is busy (DOC-34 §10)', () => {
  test('E-176 answers 503 service_unavailable with Retry-After: 5 when the renderer fails', async () => {
    const busy = containerFor(db.url, {
      storage: new FakeStorage(),
      pdfRenderer: {
        render: async () => {
          throw new PdfRenderFailure('busy', 'no free render host')
        },
      },
    })
    try {
      const res = await api(busy.app, `/staff/charges/${chargeA1}/pdf`, { token: manager })
      expect(res.status).toBe(503)
      expect(res.headers.get('retry-after')).toBe('5')
      expect((await errorOf(res)).code).toBe('service_unavailable')
    } finally {
      await busy.container.close()
    }
  })
})
