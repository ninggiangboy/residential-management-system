import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import { DomainError, UuidV7Generator } from '@core/kernel'
import { FakeClock } from '@core/testing'
import { auditActionCatalogOf, auditManifest, installAudit } from '@mod/audit'
import {
  type BuildingId,
  type BuildingScope,
  buildingToday,
  money,
  type StaffContext,
  type StaffId,
  type StaffRole,
} from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { eq, sql } from 'drizzle-orm'
import { financeManifest } from '../src'
import type { AgingBucket } from '../src/domain/aging'
import { createFinanceModule, type FinanceModule } from '../src/finance.module'
import {
  chargeLine,
  charge as chargeTable,
  feeBatch,
} from '../src/infrastructure/persistence/schema'
import { TEST_ZONE, testPorts } from './support/ports'

/**
 * The P2-10 tests of DOC-22 §8 (LG-34…LG-42) on a clone of the migrated template, with the real audit module, the Drizzle
 * `DebtQueries` and a `FakeClock`. Charges are seeded by inserting `fee_batch` rows with charges as `draft` plus their lines
 * and then moving them to `open` — the guard triggers require the lines before the status change. The `paid` and `void`
 * states of LG-36 go through the real `recordManualPayment` and `voidCharge`. LG-41 seeds 5,000 units × 24 batches as
 * `rms_migrator` through the same guarded path (no `session_replication_role`, which needs a superuser) and is timed.
 */

const silent = { info() {}, warn() {}, error() {}, debug() {} }
/** The fixture instant: the building day (Asia/Ho_Chi_Minh) is 2026-10-19. */
const AT = new Date('2026-10-19T03:00:00Z')
const DUE = '2026-10-15'
const CHARGE_AMOUNT = 100_000
const BATCH_NAME = { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' }
const ITEM_NAME = { vi: 'Phí quản lý', en: 'Management fee' }
/** The first unit of the LG-41 bulk seed. */
const BULK_UNIT = '000000d0-0000-7000-8000-000000000001'

/** DOC-22 §8.3: the due date is 2026-10-15 in `Asia/Ho_Chi_Minh`; each instant with its days past due and bucket. */
const BOUNDARY: ReadonlyArray<readonly [Date, number, AgingBucket]> = [
  [new Date('2026-10-14T05:00:00Z'), -1, 'not_yet_due'], // 2026-10-14 12:00 +07
  [new Date('2026-10-14T17:00:00Z'), 0, 'not_yet_due'], // 2026-10-15 00:00 +07
  [new Date('2026-10-15T16:30:00Z'), 0, 'not_yet_due'], // 2026-10-15 23:30 +07
  [new Date('2026-10-15T17:30:00Z'), 1, '1-30'], // 2026-10-16 00:30 +07
  [new Date('2026-10-15T23:59:00Z'), 1, '1-30'], // 2026-10-16 06:59 +07
  [new Date('2026-11-14T05:00:00Z'), 30, '1-30'], // 2026-11-14 12:00 +07
  [new Date('2026-11-15T05:00:00Z'), 31, '31-60'], // 2026-11-15 12:00 +07
  [new Date('2026-12-14T05:00:00Z'), 60, '31-60'], // 2026-12-14 12:00 +07
  [new Date('2026-12-15T05:00:00Z'), 61, '61-90'], // 2026-12-15 12:00 +07
  [new Date('2027-01-13T05:00:00Z'), 90, '61-90'], // 2027-01-13 12:00 +07
  [new Date('2027-01-14T05:00:00Z'), 91, 'over_90'], // 2027-01-14 12:00 +07
]

let db: TestDb
let database: Database
let admin: ReturnType<TestDb['admin']>
let audit: ReturnType<typeof installAudit>
let finance: FinanceModule
const ids = new UuidV7Generator()
const clock = new FakeClock(AT)

const staff = (role: StaffRole, buildingId: string): StaffContext => ({
  buildingId: buildingId as BuildingId,
  staffId: ids.next() as StaffId,
  role,
  scope: { buildingId: buildingId as BuildingId },
})

const scopeOf = (buildingId: string): BuildingScope => ({ buildingId: buildingId as BuildingId })

/** A deterministic fixture id (a v7-shaped uuid) for the raw-SQL seeds. */
const bulkKey = (prefix: string, n: number): string =>
  `${prefix}-0000-7000-8000-${String(n).padStart(12, '0')}`

/** The code of a refused call: the `DomainError` code and its first detail rule, or `ok`. */
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'ok'
  } catch (error) {
    if (!(error instanceof DomainError)) throw error
    const details = (error as { details?: unknown }).details
    const rule = Array.isArray(details) ? (details[0] as { code?: string })?.code : undefined
    return rule ? `${error.code}:${rule}` : error.code
  }
}

/** Move the shared `FakeClock` to `instant` (it only advances). */
function setClock(instant: Date): void {
  clock.advance(instant.getTime() - clock.now().getTime())
}

function buildModule(): FinanceModule {
  return createFinanceModule({
    database,
    clock,
    ids,
    logger: silent,
    audited: audit.audited,
    units: { findUnitsByCodes: async () => [] },
    files: {
      read: () => Promise.reject(new Error('no file is read by the debt reads')),
      attach: () => Promise.reject(new Error('no file is attached by the debt reads')),
      remove: () => Promise.reject(new Error('no file is removed by this test')),
      storeGenerated: () => Promise.reject(new Error('no file is stored by this test')),
      findByOwnerRef: () => Promise.reject(new Error('no file is looked up by this test')),
    },
    ...testPorts(),
  })
}

beforeAll(async () => {
  db = await cloneTemplate('empty')
  database = new Database({ url: db.url, poolMax: 20, prepare: false })
  admin = db.admin(4)
  audit = installAudit({
    logger: silent,
    ids,
    database,
    actions: auditActionCatalogOf([auditManifest, financeManifest]),
    purgeGraceMinutes: 0,
  })
  finance = buildModule()
})

afterAll(async () => {
  await admin.end()
  await database.close()
  await db.drop()
})

/** A `fee_batch` at `status`; the published, recalled and closed rows carry the columns their checks require. */
async function insertBatch(spec: {
  readonly building: string
  readonly code: string
  readonly status: 'draft' | 'published' | 'recalled' | 'closed'
  readonly feeMonth?: string
  readonly dueDate?: string
}): Promise<string> {
  const batchId = ids.next()
  const published = spec.status !== 'draft'
  await database.executor.insert(feeBatch).values({
    id: batchId,
    buildingId: spec.building,
    code: spec.code,
    name: BATCH_NAME,
    feeMonth: spec.feeMonth ?? '2026-10-01',
    dueDate: spec.dueDate ?? DUE,
    status: spec.status,
    createdBy: ids.next(),
    publishedAt: published ? AT : null,
    publishedBy: published ? ids.next() : null,
    recalledAt: spec.status === 'recalled' ? AT : null,
    recalledBy: spec.status === 'recalled' ? ids.next() : null,
    closedAt: spec.status === 'closed' ? AT : null,
    closedBy: spec.status === 'closed' ? ids.next() : null,
    version: published ? 2 : 1,
  })
  return batchId
}

/** A charge as `draft` with one line; `open: true` then moves it to `open` (the trigger requires the line first). */
async function insertCharge(spec: {
  readonly building: string
  readonly batchId: string
  readonly unitId: string
  readonly unitCode: string
  readonly amount: number
  readonly open?: boolean
}): Promise<{ chargeId: string; version: number }> {
  const chargeId = ids.next()
  await database.executor.insert(chargeTable).values({
    id: chargeId,
    buildingId: spec.building,
    batchId: spec.batchId,
    unitId: spec.unitId,
    unitCode: spec.unitCode,
    amount: spec.amount,
    status: 'draft',
    version: 1,
  })
  await database.executor.insert(chargeLine).values({
    id: ids.next(),
    buildingId: spec.building,
    chargeId,
    position: 1,
    kind: 'fee',
    itemName: ITEM_NAME,
    quantity: '1',
    unitPrice: spec.amount,
    amount: spec.amount,
  })
  if (!spec.open) return { chargeId, version: 1 }
  await database.executor
    .update(chargeTable)
    .set({ status: 'open', version: sql`${chargeTable.version} + 1`, updatedAt: sql`now()` })
    .where(eq(chargeTable.id, chargeId))
  return { chargeId, version: 2 }
}

/** A batch of one unit's charge: one charge per batch, the key `uq_charge_batch_unit` allows no second. */
async function chargeInNewBatch(spec: {
  readonly building: string
  readonly unitId: string
  readonly unitCode: string
  readonly amount: number
  readonly code: string
  readonly status?: 'draft' | 'published' | 'recalled' | 'closed'
  readonly feeMonth?: string
  readonly dueDate?: string
}): Promise<{ chargeId: string; version: number; batchId: string; unitId: string }> {
  const batchId = await insertBatch({
    building: spec.building,
    code: spec.code,
    status: spec.status ?? 'published',
    feeMonth: spec.feeMonth,
    dueDate: spec.dueDate,
  })
  const charge = await insertCharge({
    building: spec.building,
    batchId,
    unitId: spec.unitId,
    unitCode: spec.unitCode,
    amount: spec.amount,
    open: true,
  })
  return { ...charge, batchId, unitId: spec.unitId }
}

/** `count` units with one open charge each in `batchId`, seeded as `rms_migrator`; answers the unit ids. */
let bulkSeq = 0

async function seedUnitsWithDebt(
  building: string,
  batchId: string,
  count: number,
): Promise<string[]> {
  bulkSeq += 1
  // Fresh 8-hex prefixes per call: the charge and line ids are global keys of the clone.
  const chargePrefix = (0xe0000000 + bulkSeq * 2).toString(16)
  const linePrefix = (0xe0000001 + bulkSeq * 2).toString(16)
  const unitPrefix = (0xf0000000 + bulkSeq).toString(16)
  const units = Array.from({ length: count }, (_, index) => bulkKey(unitPrefix, index + 1))
  await admin.unsafe(`
    INSERT INTO finance.charge (id, building_id, batch_id, unit_id, unit_code, amount, status, version)
    SELECT ('${chargePrefix}-0000-7000-8000-' || lpad(n::text, 12, '0'))::uuid,
           '${building}'::uuid, '${batchId}'::uuid,
           ('${unitPrefix}-0000-7000-8000-' || lpad(n::text, 12, '0'))::uuid,
           'A-' || n, ${CHARGE_AMOUNT}, 'draft', 1
      FROM generate_series(1, ${count}) AS n;
    INSERT INTO finance.charge_line
      (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
    SELECT ('${linePrefix}-0000-7000-8000-' || lpad(n::text, 12, '0'))::uuid,
           '${building}'::uuid, ('${chargePrefix}-0000-7000-8000-' || lpad(n::text, 12, '0'))::uuid,
           1, 'fee', '{"vi":"Phí quản lý","en":"Management fee"}'::jsonb, 1,
           ${CHARGE_AMOUNT}, ${CHARGE_AMOUNT}
      FROM generate_series(1, ${count}) AS n;
    UPDATE finance.charge SET status = 'open', version = version + 1, updated_at = now()
     WHERE building_id = '${building}'::uuid AND batch_id = '${batchId}'::uuid AND status = 'draft';
  `)
  return units
}

async function reminderCount(building: string): Promise<number> {
  const [row] = await admin<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM finance.debt_reminder WHERE building_id = ${building}`
  return row?.n ?? 0
}

async function outboxRows(
  building: string,
  type: string,
): Promise<Array<{ payload: Record<string, unknown> }>> {
  return admin<Array<{ payload: Record<string, unknown> }>>`
    SELECT payload FROM finance.outbox_messages
     WHERE type = ${type} AND payload->>'buildingId' = ${building}
     ORDER BY id`
}

async function chargeCounts(building: string): Promise<{ total: number; open: number }> {
  const [row] = await admin<Array<{ total: number; open: number }>>`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'open')::int AS open
      FROM finance.charge WHERE building_id = ${building}`
  return { total: row?.total ?? 0, open: row?.open ?? 0 }
}

/** The best (fastest) of `runs` timings of `fn`, with the value of the fastest run. */
async function bestOf<T>(runs: number, fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  let best = Number.POSITIVE_INFINITY
  let value: T | undefined
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now()
    value = await fn()
    best = Math.min(best, performance.now() - started)
  }
  return { ms: Math.round(best), value: value as T }
}

describe('debt reads and reminders (DOC-22 §8, §16.5, P2-10)', () => {
  test('LG-34/LG-35 the days past due and the bucket follow the building day, not UTC (FR-12.1, FR-12.2)', async () => {
    const building = ids.next()
    const unit = ids.next()
    await chargeInNewBatch({
      building,
      unitId: unit,
      unitCode: 'A-1508',
      amount: CHARGE_AMOUNT,
      code: 'PH-2610-01',
      dueDate: DUE,
    })
    const scope = scopeOf(building)

    for (const [instant, days, bucket] of BOUNDARY) {
      setClock(instant)
      const view = await finance.queries.debts.unit(scope, unit)
      expect(view.charges[0]?.daysPastDue).toBe(days)
      expect(view.charges[0]?.bucket).toBe(bucket)

      const aging = await finance.queries.debts.aging(scope)
      const row = aging.find((entry) => entry.charges === 1)
      expect(row?.bucket).toBe(bucket)
      expect(row?.amount).toBe(money(CHARGE_AMOUNT))
    }
  })

  test('LG-36 the debt counts only the open charges of published or closed batches (FR-12.3)', async () => {
    setClock(AT)
    const building = ids.next()
    const unit = ids.next()
    const manager = staff('manager', building)
    const scope = scopeOf(building)
    const amounts = [120_000, 230_000, 340_000]
    for (let i = 0; i < amounts.length; i += 1)
      await chargeInNewBatch({
        building,
        unitId: unit,
        unitCode: 'A-1508',
        amount: amounts[i]!,
        code: `PH-2610-0${i + 1}`,
      })
    const paid = await chargeInNewBatch({
      building,
      unitId: unit,
      unitCode: 'A-1508',
      amount: 450_000,
      code: 'PH-2610-04',
    })
    const voided = await chargeInNewBatch({
      building,
      unitId: unit,
      unitCode: 'A-1508',
      amount: 560_000,
      code: 'PH-2610-05',
    })
    await chargeInNewBatch({
      building,
      unitId: unit,
      unitCode: 'A-1508',
      amount: 670_000,
      code: 'PH-2610-06',
      status: 'draft',
    })

    await finance.useCases.recordManualPayment.execute(
      manager,
      {
        unitId: unit,
        chargeIds: [paid.chargeId],
        amount: null,
        method: 'cash',
        payerName: 'Trần Minh Anh',
        receivedOn: buildingToday(clock.now(), TEST_ZONE),
        bankReference: null,
        statementLineId: null,
        note: null,
        dryRun: false,
      },
      ids.next(),
    )
    await finance.useCases.voidCharge.execute(manager, voided.chargeId, {
      reason: 'billed to the wrong unit',
      version: voided.version,
    })

    const total = amounts.reduce((sum, amount) => sum + amount, 0)
    const view = await finance.queries.debts.unit(scope, unit)
    expect(view.count).toBe(3)
    expect(view.total).toBe(money(total))

    const list = await finance.queries.debts.list(scope, { limit: 50 })
    const row = list.rows.find((entry) => entry.unitId === unit)
    expect(row?.outstanding).toBe(money(total))
    expect(row?.openCharges).toBe(3)
  })

  test('LG-37 an extended due date moves the charge to not yet due on the next read (FR-44.3)', async () => {
    setClock(AT)
    const building = ids.next()
    const unit = ids.next()
    const scope = scopeOf(building)
    const seeded = await chargeInNewBatch({
      building,
      unitId: unit,
      unitCode: 'A-1508',
      amount: CHARGE_AMOUNT,
      code: 'PH-2610-01',
      dueDate: '2026-10-16',
    })

    const before = await finance.queries.debts.unit(scope, unit)
    expect(before.charges[0]?.daysPastDue).toBe(3)
    expect(before.charges[0]?.bucket).toBe('1-30')

    await admin`UPDATE finance.fee_batch
                   SET due_date = '2026-10-25', version = version + 1, updated_at = now()
                 WHERE id = ${seeded.batchId}`

    const after = await finance.queries.debts.unit(scope, unit)
    expect(after.charges[0]?.daysPastDue).toBe(-6)
    expect(after.charges[0]?.bucket).toBe('not_yet_due')
  })

  test('LG-38 one reminder per unit per building day; a next-day call is a new one (FR-12.4, §8.5)', async () => {
    setClock(AT)
    const building = ids.next()
    const manager = staff('manager', building)
    const batchId = await insertBatch({ building, code: 'PH-2610-01', status: 'published' })
    const units = await seedUnitsWithDebt(building, batchId, 20)

    const first = await finance.useCases.sendDebtReminders.execute(manager, { unitIds: units })
    expect(first).toEqual({ sent: 20, alreadyRemindedToday: 0, noDebt: 0 })
    expect(await reminderCount(building)).toBe(20)
    const messages = await outboxRows(building, 'finance.debt_reminder_sent.v1')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.payload.part).toBe(1)
    expect(messages[0]?.payload.parts).toBe(1)
    expect((messages[0]?.payload.reminders as unknown[] | undefined)?.length).toBe(20)

    clock.advance(2 * 60 * 60 * 1000)
    const second = await finance.useCases.sendDebtReminders.execute(manager, { unitIds: units })
    expect(second).toEqual({ sent: 0, alreadyRemindedToday: 20, noDebt: 0 })

    setClock(new Date('2026-10-19T17:30:00Z')) // 2026-10-20 00:30 +07
    const third = await finance.useCases.sendDebtReminders.execute(manager, { unitIds: units })
    expect(third).toEqual({ sent: 20, alreadyRemindedToday: 0, noDebt: 0 })
    expect(await reminderCount(building)).toBe(40)
    expect(await outboxRows(building, 'finance.debt_reminder_sent.v1')).toHaveLength(2)
  })

  test('LG-39 a unit with nothing open is skipped and counted as noDebt (FR-12.4)', async () => {
    setClock(AT)
    const building = ids.next()
    const manager = staff('manager', building)

    const result = await finance.useCases.sendDebtReminders.execute(manager, {
      unitIds: [ids.next()],
    })
    expect(result).toEqual({ sent: 0, alreadyRemindedToday: 0, noDebt: 1 })
    expect(await reminderCount(building)).toBe(0)
  })

  test('the reminder request rules: 1 to 500 distinct units, Manager or Admin (§8.5, §13)', async () => {
    setClock(AT)
    const building = ids.next()
    const manager = staff('manager', building)
    const technician = staff('technician', building)
    const tooMany = Array.from({ length: 501 }, () => ids.next())

    expect(
      await codeOf(() => finance.useCases.sendDebtReminders.execute(manager, { unitIds: tooMany })),
    ).toBe('validation_failed:too_many_units')
    expect(
      await codeOf(() => finance.useCases.sendDebtReminders.execute(manager, { unitIds: [] })),
    ).toBe('validation_failed:no_unit_selected')
    expect(
      await codeOf(() =>
        finance.useCases.sendDebtReminders.execute(technician, { unitIds: [ids.next()] }),
      ),
    ).toBe('forbidden')
  })

  test('a call of 500 units writes one part of 500 reminders; 600 is refused (FAN_OUT_CHUNK)', async () => {
    setClock(AT)
    const building = ids.next()
    const manager = staff('manager', building)
    const batchId = await insertBatch({ building, code: 'PH-2610-01', status: 'published' })
    const units = await seedUnitsWithDebt(building, batchId, 600)

    expect(
      await codeOf(() => finance.useCases.sendDebtReminders.execute(manager, { unitIds: units })),
    ).toBe('validation_failed:too_many_units')

    const result = await finance.useCases.sendDebtReminders.execute(manager, {
      unitIds: units.slice(0, 500),
    })
    expect(result).toEqual({ sent: 500, alreadyRemindedToday: 0, noDebt: 0 })
    const messages = await outboxRows(building, 'finance.debt_reminder_sent.v1')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.payload.parts).toBe(1)
    expect((messages[0]?.payload.reminders as unknown[] | undefined)?.length).toBe(500)
  }, 30_000)

  test('LG-42 the collection rate ignores a recalled and a draft batch (§8.1, DR-267)', async () => {
    setClock(AT)
    const building = ids.next()
    const manager = staff('manager', building)
    const october = await chargeInNewBatch({
      building,
      unitId: ids.next(),
      unitCode: 'A-1',
      amount: CHARGE_AMOUNT,
      code: 'PH-2610-01',
      feeMonth: '2026-10-01',
    })
    await finance.useCases.recordManualPayment.execute(
      manager,
      {
        unitId: october.unitId,
        chargeIds: [october.chargeId],
        amount: null,
        method: 'cash',
        payerName: 'Trần Minh Anh',
        receivedOn: buildingToday(clock.now(), TEST_ZONE),
        bankReference: null,
        statementLineId: null,
        note: null,
        dryRun: false,
      },
      ids.next(),
    )
    await chargeInNewBatch({
      building,
      unitId: ids.next(),
      unitCode: 'A-2',
      amount: CHARGE_AMOUNT,
      code: 'PH-2611-01',
      feeMonth: '2026-11-01',
    })
    await chargeInNewBatch({
      building,
      unitId: ids.next(),
      unitCode: 'A-3',
      amount: CHARGE_AMOUNT,
      code: 'PH-2612-01',
      feeMonth: '2026-12-01',
      status: 'recalled',
    })
    await chargeInNewBatch({
      building,
      unitId: ids.next(),
      unitCode: 'A-4',
      amount: CHARGE_AMOUNT,
      code: 'PH-2701-01',
      feeMonth: '2027-01-01',
      status: 'draft',
    })

    const months = await finance.queries.debts.collectionByMonth(scopeOf(building))
    expect(months.map((month) => [month.feeMonth as string, month.rate])).toEqual([
      ['2026-10-01', 100],
      ['2026-11-01', 0],
    ])
  })
})

/**
 * 5,000 units × 24 published batches through the guarded path of DOC-15 §11 (draft charges, their lines, then `open`; a
 * share then voided alone), as `rms_migrator`: `session_replication_role` needs a superuser, which the clone does not give.
 * `openPercent` of the charges stay open (DOC-22 §8.6: 15% and the worst case of 100%).
 */
async function seedScale(building: string, prefix: string, openPercent: number): Promise<void> {
  const createdBy = ids.next()
  await admin.unsafe(`
    INSERT INTO finance.fee_batch
      (id, building_id, code, name, fee_month, due_date, status, created_by, published_at, published_by, version)
    SELECT ('${prefix}b0-0000-7000-8000-' || lpad(b::text, 12, '0'))::uuid,
           '${building}'::uuid, 'PH-2601-' || lpad(b::text, 2, '0'),
           '{"vi":"Phí tháng 1/2026","en":"January 2026 fees"}'::jsonb,
           date '2026-01-01', date '2026-10-15', 'published', '${createdBy}'::uuid,
           timestamptz '2026-01-01T00:00:00Z', '${createdBy}'::uuid, 2
      FROM generate_series(1, 24) AS b;
    INSERT INTO finance.charge (id, building_id, batch_id, unit_id, unit_code, amount, status, version)
    SELECT ('${prefix}c0-0000-7000-8000-' || lpad((u * 24 + b)::text, 12, '0'))::uuid,
           '${building}'::uuid, ('${prefix}b0-0000-7000-8000-' || lpad(b::text, 12, '0'))::uuid,
           ('000000d0-0000-7000-8000-' || lpad(u::text, 12, '0'))::uuid, 'A-' || u, 100000, 'draft', 1
      FROM generate_series(1, 5000) AS u CROSS JOIN generate_series(1, 24) AS b;
    INSERT INTO finance.charge_line
      (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
    SELECT ('${prefix}c1-0000-7000-8000-' || lpad((u * 24 + b)::text, 12, '0'))::uuid, '${building}'::uuid,
           ('${prefix}c0-0000-7000-8000-' || lpad((u * 24 + b)::text, 12, '0'))::uuid,
           1, 'fee', '{"vi":"Phí quản lý","en":"Management fee"}'::jsonb, 1, 100000, 100000
      FROM generate_series(1, 5000) AS u CROSS JOIN generate_series(1, 24) AS b;
    UPDATE finance.charge SET status = 'open', version = version + 1, updated_at = now()
     WHERE building_id = '${building}'::uuid AND status = 'draft';
    UPDATE finance.charge
       SET status = 'void', void_kind = 'single', void_reason = 'seeded without an allocation',
           voided_at = now(), voided_by = '${createdBy}'::uuid, version = version + 1, updated_at = now()
     WHERE building_id = '${building}'::uuid AND status = 'open'
       AND ('x' || substr(replace(id::text, '-', ''), 21, 12))::bit(48)::bigint % 100 >= ${openPercent};
    ANALYZE finance.charge;
    ANALYZE finance.fee_batch;
    ANALYZE finance.charge_line;
  `)
}

describe('LG-41 debt reads at scale (DOC-22 §8.6, P2-10 acceptance, timed)', () => {
  test('5,000 units x 24 batches: the list, the aging and one unit stay inside the budgets', async () => {
    setClock(AT)
    const building = ids.next()
    await seedScale(building, '0000a0', 15)

    const counts = await chargeCounts(building)
    expect(counts.total).toBe(120_000)
    expect(counts.open).toBeGreaterThan(17_000)
    expect(counts.open).toBeLessThan(19_000)

    const scope = scopeOf(building)
    const list = await bestOf(3, () => finance.queries.debts.list(scope, { limit: 100 }))
    const aging = await bestOf(3, () => finance.queries.debts.aging(scope))
    const unit = await bestOf(3, () => finance.queries.debts.unit(scope, BULK_UNIT))
    console.log(`LG-41 15% open: list ${list.ms} ms, aging ${aging.ms} ms, unit ${unit.ms} ms`)
    expect(list.ms).toBeLessThanOrEqual(50)
    expect(aging.ms).toBeLessThanOrEqual(200)
    expect(unit.ms).toBeLessThanOrEqual(50)

    // The worst case (every charge open) on a second building: a void charge is never reopened (DOC-21 §3.9).
    const worst = ids.next()
    await seedScale(worst, '0000a1', 100)
    expect((await chargeCounts(worst)).open).toBe(120_000)
    const worstScope = scopeOf(worst)
    const agingAll = await bestOf(3, () => finance.queries.debts.aging(worstScope))
    const listAll = await bestOf(3, () => finance.queries.debts.list(worstScope, { limit: 100 }))
    const unitAll = await bestOf(3, () => finance.queries.debts.unit(worstScope, BULK_UNIT))
    console.log(
      `LG-41 all open: list ${listAll.ms} ms, aging ${agingAll.ms} ms, unit ${unitAll.ms} ms`,
    )
    expect(agingAll.ms).toBeLessThanOrEqual(200)
  }, 300_000)
})
