import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import { DomainError, UuidV7Generator } from '@core/kernel'
import { FakeClock } from '@core/testing'
import { auditActionCatalogOf, auditManifest, installAudit } from '@mod/audit'
import type { BuildingId, LocalDate, StaffContext, StaffId, StaffRole } from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { financeManifest } from '../src'
import type { FoundUnitDto } from '../src/application/ports'
import { createFinanceModule, type FinanceModule } from '../src/finance.module'
import { makeBarrier } from './support'
import { testPorts } from './support/ports'

/**
 * The lifecycle use cases of DOC-21 §3.3–§3.7 and §3.9 (P2-05): publish (with the two-publish race LG-61 and the chunking of
 * MC-06), extend the due date, close, re-issue and the single void a re-issue copies around, on a clone of the migrated
 * template with the real audit module and a unit directory standing in for `ResidencyApi.findUnitsByCodes` (DOC-21 §2.1,
 * DR-265). Batch events are read from `finance.outbox_messages`, audit rows from `audit.audit_log` (DOC-09 §6.1, DOC-35 §2).
 */

const silent = { info() {}, warn() {}, error() {}, debug() {} }
const OCTOBER = '2026-10-01' as LocalDate
const DUE = '2026-10-15' as LocalDate
const NAME = { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' }

let db: TestDb
let database: Database
let admin: ReturnType<TestDb['admin']>
let finance: FinanceModule
const ids = new UuidV7Generator()
const units = new Map<string, FoundUnitDto>()

const staff = (role: StaffRole, buildingId: string): StaffContext => ({
  buildingId: buildingId as BuildingId,
  staffId: ids.next() as StaffId,
  role,
  scope: { buildingId: buildingId as BuildingId },
})

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

/** Registers a unit with an active owner in the directory the module reads (DOC-21 §4.3). */
function seedUnit(code: string, hasActiveOwner = true): FoundUnitDto {
  const found = { unitId: ids.next(), code, occupancy: 'occupied' as const, hasActiveOwner }
  units.set(code.toLowerCase(), found)
  return found
}

beforeAll(async () => {
  db = await cloneTemplate('empty')
  database = new Database({ url: db.url, poolMax: 20, prepare: false })
  admin = db.admin(4)
  const audit = installAudit({
    logger: silent,
    ids,
    database,
    actions: auditActionCatalogOf([auditManifest, financeManifest]),
    purgeGraceMinutes: 0,
  })
  finance = createFinanceModule({
    database,
    clock: new FakeClock(new Date('2026-10-01T03:00:00Z')),
    ids,
    logger: silent,
    audited: audit.audited,
    units: {
      findUnitsByCodes: async (_building, codes) =>
        codes.flatMap((code) => {
          const unit = units.get(code.toLowerCase())
          return unit ? [unit] : []
        }),
    },
    files: {
      read: () => Promise.reject(new Error('no file is read by the lifecycle use cases')),
      attach: () => Promise.reject(new Error('no file is attached by the lifecycle use cases')),
    },

    ...testPorts(),
  })
})

afterAll(async () => {
  await admin.end({ timeout: 2 })
  await database.close()
  await db.drop()
})

/** One seeded line; `amount` is the half-up product of `quantity × unitPrice` (`ck_charge_line_amount`, DOC-21 §4.2). */
interface SeedLine {
  readonly itemName: { readonly vi: string }
  readonly quantity: string
  readonly unitPrice: number
  readonly amount: number
}

interface SeededCharge {
  readonly id: string
  readonly unitId: string
  readonly unitCode: string
  readonly amount: number
}

interface SeededBatch {
  readonly batchId: string
  readonly code: string
  readonly version: number
  readonly charges: readonly SeededCharge[]
}

const feeLine = (amount: number): SeedLine => ({
  itemName: { vi: 'Phí quản lý' },
  quantity: '1',
  unitPrice: amount,
  amount,
})

/** The management fee plus the water line of the FNM fixture: 2,488,000 + 185,175 (DOC-21 §4.2). */
const TWO_LINES: readonly SeedLine[] = [
  feeLine(2_488_000),
  { itemName: { vi: 'Nước' }, quantity: '12.345', unitPrice: 15_000, amount: 185_175 },
]

/**
 * Seeds `count` draft charges (and their lines) into a batch through SQL, as `fee-batches.integration.test.ts` seeds its
 * fixtures: `amount` equals the sum of the lines, so the draft → open trigger accepts the publish (`trg_charge_guard`).
 */
async function seedCharges(
  buildingId: string,
  batchId: string,
  count: number,
  lines: readonly SeedLine[],
  unitPrefix = 'A',
): Promise<SeededCharge[]> {
  const amount = lines.reduce((sum, line) => sum + line.amount, 0)
  const charges: SeededCharge[] = []
  for (let index = 0; index < count; index += 1) {
    const id = ids.next()
    const unitId = ids.next()
    const unitCode = `${unitPrefix}-${1001 + index}`
    await admin`INSERT INTO finance.charge
        (id, building_id, batch_id, unit_id, unit_code, amount, status, version)
      VALUES (${id}, ${buildingId}, ${batchId}, ${unitId}, ${unitCode}, ${amount}, 'draft', 1)`
    for (const [position, line] of lines.entries()) {
      await admin`INSERT INTO finance.charge_line
          (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
        VALUES (${ids.next()}, ${buildingId}, ${id}, ${position + 1}, 'fee',
                ${admin.json({ vi: line.itemName.vi })},
                ${line.quantity}, ${line.unitPrice}, ${line.amount})`
    }
    charges.push({ id, unitId, unitCode, amount })
  }
  return charges
}

/** Seeds a `draft` batch with its charges; the publish use case owns the draft → published transition of DOC-21 §3.3. */
async function seedDraftBatch(
  buildingId: string,
  options: {
    readonly code: string
    readonly chargeCount: number
    readonly lines?: readonly SeedLine[]
    readonly dueDate?: LocalDate
    readonly feeMonth?: LocalDate
    readonly unitPrefix?: string
  },
): Promise<SeededBatch> {
  const batchId = ids.next()
  const lines = options.lines ?? [feeLine(2_488_000)]
  await admin`INSERT INTO finance.fee_batch
      (id, building_id, code, name, fee_month, due_date, status, created_by, version)
    VALUES (${batchId}, ${buildingId}, ${options.code}, ${admin.json({ vi: NAME.vi })},
            ${options.feeMonth ?? OCTOBER}, ${options.dueDate ?? DUE}, 'draft', ${ids.next()}, 1)`
  const charges = await seedCharges(
    buildingId,
    batchId,
    options.chargeCount,
    lines,
    options.unitPrefix,
  )
  return { batchId, code: options.code, version: 1, charges }
}

/** Releases `racers` together behind a barrier (`makeBarrier`) and collects their outcomes (DOC-22 §16.2). */
async function race<T>(racers: ReadonlyArray<() => Promise<T>>): Promise<T[]> {
  const barrier = makeBarrier(racers.length)
  const started = racers.map(async (racer) => {
    await barrier.wait()
    return racer()
  })
  barrier.go()
  const settled = await Promise.allSettled(started)
  return settled.map((outcome) => {
    if (outcome.status === 'rejected') throw outcome.reason
    return outcome.value
  })
}

describe('publish (DOC-21 §3.3, P2-05)', () => {
  test('LG-61 two Managers publish the same draft of 240 charges released together: one wins, 240 open, one event (FR-03.2, FNM-S01)', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const seeded = await seedDraftBatch(building, { code: 'PH-2610-01', chargeCount: 240 })
    const publish = () =>
      codeOf(() =>
        finance.useCases.publishFeeBatch.execute(manager, seeded.batchId, seeded.version),
      )
    const outcomes = (await race([publish, publish])).sort()
    const loser = outcomes.find((outcome) => outcome !== 'ok') as string
    expect(outcomes.filter((outcome) => outcome === 'ok')).toHaveLength(1)
    expect(['invalid_transition', 'version_conflict']).toContain(loser)

    const [counts] = await db.sql`
      SELECT count(*) FILTER (WHERE status = 'open')::int AS open,
             count(*) FILTER (WHERE status = 'draft')::int AS draft
        FROM finance.charge WHERE batch_id = ${seeded.batchId}`
    expect([counts?.open, counts?.draft]).toEqual([240, 0])

    const events = await db.sql`SELECT payload FROM finance.outbox_messages
       WHERE aggregate_id = ${seeded.batchId} AND type = 'finance.batch_published.v1'`
    expect(events).toHaveLength(1)
    const payload = events[0]?.payload as {
      unitIds: string[]
      part: number
      parts: number
      feeMonth: string
      code: string
    }
    expect([payload.part, payload.parts, payload.unitIds.length]).toEqual([1, 1, 240])
    expect(payload.feeMonth).toBe('2026-10')
    expect(payload.code).toBe('PH-2610-01')

    const audit = await db.sql`SELECT action, object_type FROM audit.audit_log
       WHERE object_id = ${seeded.batchId} AND action = 'finance.batch.publish'`
    expect(audit.map((row) => [row.action, row.object_type])).toEqual([
      ['finance.batch.publish', 'fee_batch'],
    ])
  })

  test('LG-61b 1,201 charged units write three batch_published rows of 500, 500 and 201 (MC-06, DOC-09 §3.4)', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const seeded = await seedDraftBatch(building, { code: 'PH-2610-01', chargeCount: 1_201 })
    await finance.useCases.publishFeeBatch.execute(manager, seeded.batchId, seeded.version)
    const rows = await db.sql`SELECT payload FROM finance.outbox_messages
       WHERE aggregate_id = ${seeded.batchId} AND type = 'finance.batch_published.v1'
       ORDER BY (payload ->> 'part')::int`
    expect(rows).toHaveLength(3)
    const parts = rows.map((row) => {
      const payload = row.payload as { part: number; parts: number; unitIds: string[] }
      return [payload.part, payload.parts, payload.unitIds.length]
    })
    expect(parts).toEqual([
      [1, 3, 500],
      [2, 3, 500],
      [3, 3, 201],
    ])
  })

  test('LG-62 an edit that bumped the batch version makes a publish with the old version 409 version_conflict (DOC-21 §3.2)', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const batch = await finance.useCases.createFeeBatch.execute(manager, {
      name: NAME,
      feeMonth: OCTOBER,
      dueDate: DUE,
    })
    const found = seedUnit('A-1508')
    await finance.useCases.addDraftCharge.execute(manager, batch.id, {
      unitCode: found.code.toLowerCase(),
      lines: [{ itemName: { vi: 'Phí quản lý' }, quantity: '1', unitPrice: 2_488_000 }],
    })
    expect(
      await codeOf(() =>
        finance.useCases.publishFeeBatch.execute(manager, batch.id, batch.version),
      ),
    ).toBe('version_conflict')
    const fresh = await finance.queries.feeBatches.batch(manager.scope, batch.id)
    expect([fresh.status, fresh.version]).toEqual(['draft', 2])
  })

  test('LG-64 a draft with no charge and a due date before building today: 400 and nothing changes (FR-03.1)', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const empty = await finance.useCases.createFeeBatch.execute(manager, {
      name: NAME,
      feeMonth: OCTOBER,
      dueDate: DUE,
    })
    expect(
      await codeOf(() =>
        finance.useCases.publishFeeBatch.execute(manager, empty.id, empty.version),
      ),
    ).toBe('validation_failed:no_charges')
    const [afterEmpty] = await db.sql`SELECT status, version FROM finance.fee_batch
       WHERE id = ${empty.id}`
    expect([afterEmpty?.status, afterEmpty?.version]).toEqual(['draft', 1])

    // charge_total_zero cannot be seeded through SQL: ck_charge_amount refuses amount <= 0 and the trigger keeps a charge
    // equal to the sum of its lines, so the §3.3 third check has no fixture here (only the unit-level net covers it).
    const past = await finance.useCases.createFeeBatch.execute(manager, {
      name: NAME,
      feeMonth: OCTOBER,
      dueDate: '2026-09-30' as LocalDate,
    })
    await seedCharges(building, past.id, 1, [feeLine(2_488_000)])
    expect(
      await codeOf(() => finance.useCases.publishFeeBatch.execute(manager, past.id, past.version)),
    ).toBe('validation_failed:due_date_in_past')
    const [afterPast] = await db.sql`SELECT status, version FROM finance.fee_batch
       WHERE id = ${past.id}`
    expect([afterPast?.status, afterPast?.version]).toEqual(['draft', 1])

    const outbox = await db.sql`SELECT 1 FROM finance.outbox_messages
       WHERE aggregate_id IN (${empty.id}, ${past.id})`
    expect(outbox).toHaveLength(0)
  })

  test('LG-64b a second publish is 409, no If-Match is 428 and a Technician is 403 (FR-49.2, DOC-21 §8)', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const seeded = await seedDraftBatch(building, { code: 'PH-2610-01', chargeCount: 2 })
    const published = await finance.useCases.publishFeeBatch.execute(manager, seeded.batchId, 1)
    expect(
      await codeOf(() =>
        finance.useCases.publishFeeBatch.execute(manager, seeded.batchId, published.version),
      ),
    ).toBe('invalid_transition')
    expect(
      await codeOf(() =>
        finance.useCases.publishFeeBatch.execute(manager, seeded.batchId, undefined),
      ),
    ).toBe('precondition_required')
    expect(
      await codeOf(() =>
        finance.useCases.publishFeeBatch.execute(
          staff('technician', building),
          seeded.batchId,
          published.version,
        ),
      ),
    ).toBe('forbidden')
  })
})

describe('extend the due date (DOC-21 §3.4, FR-44)', () => {
  test('LG-66 the due date moves only later, one event and one audit row per move; a paid unit drops out', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const seeded = await seedDraftBatch(building, { code: 'PH-2610-01', chargeCount: 3 })
    const published = await finance.useCases.publishFeeBatch.execute(manager, seeded.batchId, 1)
    const extend = (dueDate: string, version: number | undefined) =>
      finance.useCases.updateFeeBatch.execute(manager, seeded.batchId, {
        dueDate: dueDate as LocalDate,
        version,
      })

    const extended = await extend('2026-10-25', published.version)
    expect<unknown[]>([extended.dueDate, extended.version]).toEqual([
      '2026-10-25',
      published.version + 1,
    ])
    const events = await db.sql`SELECT payload FROM finance.outbox_messages
       WHERE aggregate_id = ${seeded.batchId} AND type = 'finance.batch_due_extended.v1'`
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toMatchObject({
      previousDueDate: '2026-10-15',
      dueDate: '2026-10-25',
    })
    const audit = await db.sql`SELECT action, object_type FROM audit.audit_log
       WHERE object_id = ${seeded.batchId} AND action = 'finance.batch.extend_due'`
    expect(audit.map((row) => [row.action, row.object_type])).toEqual([
      ['finance.batch.extend_due', 'fee_batch'],
    ])

    expect(await codeOf(() => extend('2026-10-10', extended.version))).toBe(
      'validation_failed:due_date_not_later',
    )
    expect(await codeOf(() => extend('2026-10-30', 1))).toBe('version_conflict')

    // DOC-09 §6.1: the extension's unitIds are the units that still have an open charge.
    await admin`UPDATE finance.charge SET status = 'paid' WHERE id = ${seeded.charges[0]!.id}`
    const again = await extend('2026-11-05', extended.version)
    expect(again.version).toBe(extended.version + 1)
    const [row] = await db.sql`SELECT payload FROM finance.outbox_messages
       WHERE aggregate_id = ${seeded.batchId} AND type = 'finance.batch_due_extended.v1'
         AND payload ->> 'dueDate' = '2026-11-05'`
    const unitIds = (row?.payload as { unitIds: string[] } | undefined)?.unitIds ?? []
    expect(unitIds).toHaveLength(2)
    expect(unitIds).not.toContain(seeded.charges[0]!.unitId)
  })

  test('LG-66b two extensions to different later dates at the same version released together: exactly one wins', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const seeded = await seedDraftBatch(building, { code: 'PH-2610-01', chargeCount: 2 })
    const published = await finance.useCases.publishFeeBatch.execute(manager, seeded.batchId, 1)
    const racer = (dueDate: string) => () =>
      codeOf(() =>
        finance.useCases.updateFeeBatch.execute(manager, seeded.batchId, {
          dueDate: dueDate as LocalDate,
          version: published.version,
        }),
      )

    const outcomes = await race([racer('2026-10-25'), racer('2026-11-05')])
    expect(outcomes.filter((outcome) => outcome === 'ok')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome === 'version_conflict')).toHaveLength(1)

    const events = await db.sql`SELECT 1 FROM finance.outbox_messages
       WHERE aggregate_id = ${seeded.batchId} AND type = 'finance.batch_due_extended.v1'`
    expect(events).toHaveLength(1)
    const [batch] = await db.sql`SELECT version, due_date::text AS due_date FROM finance.fee_batch
       WHERE id = ${seeded.batchId}`
    expect(batch?.version).toBe(published.version + 1)
    expect(['2026-10-25', '2026-11-05'].includes(batch?.due_date as string)).toBe(true)
  })
})

describe('close (DOC-21 §3.6, DR-20)', () => {
  test('LG-67 the name of a published batch is refused; close freezes it with no event; closed and recalled refuse the rest', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const seeded = await seedDraftBatch(building, { code: 'PH-2610-01', chargeCount: 2 })
    const published = await finance.useCases.publishFeeBatch.execute(manager, seeded.batchId, 1)
    expect(
      await codeOf(() =>
        finance.useCases.updateFeeBatch.execute(manager, seeded.batchId, {
          name: NAME,
          version: published.version,
        }),
      ),
    ).toBe('invalid_transition')

    const closed = await finance.useCases.closeFeeBatch.execute(
      manager,
      seeded.batchId,
      published.version,
    )
    expect(closed.status).toBe('closed')
    const closeAudit = await db.sql`SELECT action FROM audit.audit_log
       WHERE object_id = ${seeded.batchId} AND action = 'finance.batch.close'`
    expect(closeAudit).toHaveLength(1)
    const types = await db.sql`SELECT DISTINCT type FROM finance.outbox_messages
       WHERE aggregate_id = ${seeded.batchId}`
    expect(types.map((row) => row.type)).toEqual(['finance.batch_published.v1'])

    expect(
      await codeOf(() =>
        finance.useCases.recallFeeBatch.execute(manager, seeded.batchId, {
          reason: 'wrong readings',
          version: closed.version,
        }),
      ),
    ).toBe('invalid_transition')
    expect(
      await codeOf(() =>
        finance.useCases.updateFeeBatch.execute(manager, seeded.batchId, {
          dueDate: '2026-11-01' as LocalDate,
          version: closed.version,
        }),
      ),
    ).toBe('invalid_transition')

    const other = await seedDraftBatch(building, { code: 'PH-2610-02', chargeCount: 2 })
    const otherPublished = await finance.useCases.publishFeeBatch.execute(manager, other.batchId, 1)
    const recalled = await finance.useCases.recallFeeBatch.execute(manager, other.batchId, {
      reason: 'wrong water readings',
      version: otherPublished.version,
    })
    expect(recalled.batch.status).toBe('recalled')
    expect(
      await codeOf(() =>
        finance.useCases.closeFeeBatch.execute(manager, other.batchId, recalled.batch.version),
      ),
    ).toBe('invalid_transition')
  })
})

describe('re-issue (DOC-21 §3.7, FR-04.5)', () => {
  test('LG-73 a re-issue copies every charge but one voided alone, under new ids and a new code (DR-265)', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const batch = await finance.useCases.createFeeBatch.execute(manager, {
      name: NAME,
      feeMonth: OCTOBER,
      dueDate: DUE,
    })
    const charges = await seedCharges(building, batch.id, 240, TWO_LINES)
    const published = await finance.useCases.publishFeeBatch.execute(
      manager,
      batch.id,
      batch.version,
    )
    const [voided] = await db.sql`SELECT id, version FROM finance.charge
       WHERE batch_id = ${batch.id} ORDER BY unit_code LIMIT 1`
    await finance.useCases.voidCharge.execute(manager, voided!.id, {
      reason: 'billed to the wrong unit',
      version: voided!.version,
    })
    const recalled = await finance.useCases.recallFeeBatch.execute(manager, batch.id, {
      reason: 'wrong water readings',
      version: published.version,
    })
    expect(recalled.chargeCount).toBe(239)

    const reissued = await finance.useCases.reissueFeeBatch.execute(manager, batch.id, {
      dueDate: '2026-10-20' as LocalDate,
    })
    expect(reissued.chargeCount).toBe(239)
    expect(reissued.batch.status).toBe('draft')
    expect(reissued.batch.code).toBe('PH-2610-02')
    expect(reissued.batch.feeMonth).toBe(OCTOBER)
    expect<string>(reissued.batch.dueDate).toBe('2026-10-20')
    expect(reissued.batch.replacesBatchId).toBe(batch.id)
    const [row] = await db.sql`SELECT replaces_batch_id FROM finance.fee_batch
       WHERE id = ${reissued.batch.id}`
    expect(row?.replaces_batch_id).toBe(batch.id)

    const copies = await db.sql`SELECT id FROM finance.charge WHERE batch_id = ${reissued.batch.id}`
    expect(copies).toHaveLength(239)
    const oldIds = new Set(charges.map((charge) => charge.id))
    expect(copies.some((copy) => oldIds.has(copy.id))).toBe(false)

    const [lines] = await db.sql`SELECT count(*)::int AS n FROM finance.charge_line l
       JOIN finance.charge c ON c.id = l.charge_id WHERE c.batch_id = ${reissued.batch.id}`
    expect(lines?.n).toBe(478)
    const shapes = await db.sql`SELECT DISTINCT l.position, l.amount::bigint AS amount
       FROM finance.charge_line l JOIN finance.charge c ON c.id = l.charge_id
       WHERE c.batch_id = ${reissued.batch.id} ORDER BY l.position`
    expect(shapes.map((shape) => [shape.position, Number(shape.amount)])).toEqual([
      [1, 2_488_000],
      [2, 185_175],
    ])

    const audit = await db.sql`SELECT action FROM audit.audit_log
       WHERE object_id = ${reissued.batch.id} AND action = 'finance.batch.reissue'`
    expect(audit).toHaveLength(1)

    // The recalled batch keeps no pointer to its children: a second re-issue makes another draft (DOC-21 §3.7).
    const second = await finance.useCases.reissueFeeBatch.execute(manager, batch.id, {})
    expect([second.batch.status, second.batch.code, second.chargeCount]).toEqual([
      'draft',
      'PH-2610-03',
      239,
    ])
  })

  test('LG-74 a re-issue of a published batch and of a draft is 409 invalid_transition (DOC-21 §3.7)', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const seeded = await seedDraftBatch(building, { code: 'PH-2610-01', chargeCount: 2 })
    expect(
      await codeOf(() => finance.useCases.reissueFeeBatch.execute(manager, seeded.batchId, {})),
    ).toBe('invalid_transition')
    await finance.useCases.publishFeeBatch.execute(manager, seeded.batchId, 1)
    expect(
      await codeOf(() => finance.useCases.reissueFeeBatch.execute(manager, seeded.batchId, {})),
    ).toBe('invalid_transition')
  })
})

describe('close keeps the charges payable (LG-75, DR-20)', () => {
  test('LG-75 a closed batch leaves its charges open and refuses the recall (LG-75)', async () => {
    const building = ids.next()
    const manager = staff('manager', building)
    const seeded = await seedDraftBatch(building, { code: 'PH-2610-01', chargeCount: 3 })
    const published = await finance.useCases.publishFeeBatch.execute(manager, seeded.batchId, 1)
    const closed = await finance.useCases.closeFeeBatch.execute(
      manager,
      seeded.batchId,
      published.version,
    )
    expect(closed.status).toBe('closed')
    const [counts] = await db.sql`SELECT count(*) FILTER (WHERE status = 'open')::int AS open
       FROM finance.charge WHERE batch_id = ${seeded.batchId}`
    expect(counts?.open).toBe(3)
    expect(
      await codeOf(() =>
        finance.useCases.recallFeeBatch.execute(manager, seeded.batchId, {
          reason: 'wrong readings',
          version: closed.version,
        }),
      ),
    ).toBe('invalid_transition')
  })
})
