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
import { testPorts } from './support/ports'

/**
 * The draft use cases of DOC-21 §3.1, §3.2 and §3.8 (P2-04) on a clone of the migrated template, with the real audit module and
 * a unit directory standing in for `ResidencyApi.findUnitsByCodes`.
 */

const silent = { info() {}, warn() {}, error() {}, debug() {} }
const feeMonth = '2026-10-01' as LocalDate
const due = '2026-10-15' as LocalDate
const NAME = { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' }
const LINES = [
  { itemName: { vi: 'Phí quản lý' }, quantity: '1', unitPrice: 2_488_000 },
  { itemName: { vi: 'Nước' }, quantity: '12.345', unitPrice: 15_000, amount: 185_175 },
  {
    kind: 'adjustment' as const,
    itemName: { vi: 'Điều chỉnh' },
    amount: -35_175,
    note: 'Trừ phí nước tính thừa tháng 9',
  },
]

let db: TestDb
let database: Database
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

beforeAll(async () => {
  db = await cloneTemplate('empty')
  database = new Database({ url: db.url, poolMax: 10, prepare: false })
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
      read: () => Promise.reject(new Error('no file is read by the draft use cases')),
      attach: () => Promise.reject(new Error('no file is attached by the draft use cases')),
      remove: () => Promise.reject(new Error('no file is removed by this test')),
      storeGenerated: () => Promise.reject(new Error('no file is stored by this test')),
      findByOwnerRef: () => Promise.reject(new Error('no file is looked up by this test')),
    },

    ...testPorts(),
  })
})

afterAll(async () => {
  await database.close()
  await db.drop()
})

function unit(code: string, hasActiveOwner = true): FoundUnitDto {
  const found = { unitId: ids.next(), code, occupancy: 'occupied' as const, hasActiveOwner }
  units.set(code.toLowerCase(), found)
  return found
}

describe('create, code and discard (DOC-21 §3.1, §3.8)', () => {
  test('LG-68 the batch series gives PH-2610-01 then -02, from the fee month', async () => {
    const manager = staff('manager', ids.next())
    const first = await finance.useCases.createFeeBatch.execute(manager, {
      name: NAME,
      feeMonth,
      dueDate: due,
    })
    const second = await finance.useCases.createFeeBatch.execute(manager, {
      name: NAME,
      feeMonth,
      dueDate: due,
    })
    expect([first.code, second.code]).toEqual(['PH-2610-01', 'PH-2610-02'])
    expect(first.status).toBe('draft')
    expect(first.version).toBe(1)
    const audit = await db.sql`SELECT action FROM audit.audit_log WHERE object_id = ${first.id}`
    expect(audit.map((row) => row.action)).toEqual(['finance.batch.create'])
  })

  test('a fee month that is not the 1st and a blank name are 400; a Technician is 403', async () => {
    const building = ids.next()
    const create = finance.useCases.createFeeBatch
    expect(
      await codeOf(() =>
        create.execute(staff('manager', building), {
          name: NAME,
          feeMonth: '2026-10-15' as LocalDate,
          dueDate: due,
        }),
      ),
    ).toBe('validation_failed:pattern')
    expect(
      await codeOf(() =>
        create.execute(staff('manager', building), { name: { vi: ' ' }, feeMonth, dueDate: due }),
      ),
    ).toBe('validation_failed:required')
    expect(
      await codeOf(() =>
        create.execute(staff('technician', building), { name: NAME, feeMonth, dueDate: due }),
      ),
    ).toBe('forbidden')
  })

  test('FR-02.4 a discarded draft code is not issued again', async () => {
    const manager = staff('manager', ids.next())
    const { createFeeBatch, discardFeeBatch } = finance.useCases
    await createFeeBatch.execute(manager, { name: NAME, feeMonth, dueDate: due })
    const second = await createFeeBatch.execute(manager, { name: NAME, feeMonth, dueDate: due })
    const discarded = await discardFeeBatch.execute(manager, second.id, second.version)
    expect(discarded).toEqual({ id: second.id, code: 'PH-2610-02', chargeCount: 0 })
    const third = await createFeeBatch.execute(manager, { name: NAME, feeMonth, dueDate: due })
    expect(third.code).toBe('PH-2610-03')
    expect(await codeOf(() => finance.queries.feeBatches.batch(manager.scope, second.id))).toBe(
      'not_found',
    )
  })

  test('a discard with a stale version is 409; without If-Match 428', async () => {
    const manager = staff('manager', ids.next())
    const batch = await finance.useCases.createFeeBatch.execute(manager, {
      name: NAME,
      feeMonth,
      dueDate: due,
    })
    expect(await codeOf(() => finance.useCases.discardFeeBatch.execute(manager, batch.id, 7))).toBe(
      'version_conflict',
    )
    expect(
      await codeOf(() => finance.useCases.discardFeeBatch.execute(manager, batch.id, undefined)),
    ).toBe('precondition_required')
  })
})

describe('the draft header (DOC-21 §3.2)', () => {
  test('a stale version is 409 version_conflict; a published batch is 409 invalid_transition', async () => {
    const manager = staff('manager', ids.next())
    const batch = await finance.useCases.createFeeBatch.execute(manager, {
      name: NAME,
      feeMonth,
      dueDate: due,
    })
    const updated = await finance.useCases.updateFeeBatch.execute(manager, batch.id, {
      dueDate: '2026-10-20' as LocalDate,
      version: 1,
    })
    expect<unknown[]>([updated.dueDate, updated.version]).toEqual(['2026-10-20', 2])
    expect(
      await codeOf(() =>
        finance.useCases.updateFeeBatch.execute(manager, batch.id, { dueDate: due, version: 1 }),
      ),
    ).toBe('version_conflict')
    await db.admin()`UPDATE finance.fee_batch SET status = 'published', published_at = now(), published_by = ${manager.staffId}
                      WHERE id = ${batch.id}`
    expect(
      await codeOf(() =>
        // FR-44.2: only a later due date changes once published (P2-05); the name is refused.
        finance.useCases.updateFeeBatch.execute(manager, batch.id, { name: NAME, version: 2 }),
      ),
    ).toBe('invalid_transition')
  })
})

describe('draft charges (DOC-21 §3.2, DR-332)', () => {
  async function draftWithCharge() {
    const manager = staff('manager', ids.next())
    const batch = await finance.useCases.createFeeBatch.execute(manager, {
      name: NAME,
      feeMonth,
      dueDate: due,
    })
    const found = unit(`A-${Math.floor(Math.random() * 1e6)}`)
    const charge = await finance.useCases.addDraftCharge.execute(manager, batch.id, {
      unitCode: found.code.toLowerCase(),
      lines: LINES,
    })
    return { manager, batch, charge, found }
  }

  test('add: A-1508 of 2,638,000 with three lines; the batch version moves', async () => {
    const { manager, batch, charge, found } = await draftWithCharge()
    expect<unknown[]>([charge.amount, charge.unitCode, charge.version]).toEqual([
      2_638_000n,
      found.code,
      1,
    ])
    const [row] = await finance.queries.feeBatches.charges(manager.scope, batch.id)
    expect(row?.lines.map((line) => [line.position, line.amount])).toEqual([
      [1, 2_488_000],
      [2, 185_175],
      [3, -35_175],
    ])
    expect((await finance.queries.feeBatches.batch(manager.scope, batch.id)).version).toBe(2)
  })

  test('add refusals: unit_not_found 404, unit_without_owner 422, charge_exists 409, not a draft 409', async () => {
    const { manager, batch, charge, found } = await draftWithCharge()
    const add = (unitCode: string) =>
      finance.useCases.addDraftCharge.execute(manager, batch.id, { unitCode, lines: LINES })
    expect(await codeOf(() => add('A-9999'))).toBe('unit_not_found')
    const vacant = unit('B-0101', false)
    expect(await codeOf(() => add(vacant.code))).toBe('validation_failed:unit_without_owner')
    let exists: unknown
    try {
      await add(found.code)
    } catch (error) {
      exists = error
    }
    expect((exists as DomainError).code).toBe('charge_exists')
    expect((exists as { details?: unknown }).details).toEqual({ chargeId: charge.id })
    await db.admin()`UPDATE finance.fee_batch SET status = 'published', published_at = now(), published_by = ${manager.staffId}
                      WHERE id = ${batch.id}`
    expect(await codeOf(() => add(unit('C-0101').code))).toBe('invalid_transition')
  })

  test('replace with a stale version is 409 version_conflict (master plan P2-04)', async () => {
    const { manager, charge } = await draftWithCharge()
    const replace = finance.useCases.replaceDraftCharge
    const after = await replace.execute(manager, charge.id, {
      lines: LINES.slice(0, 1),
      version: 1,
    })
    expect<unknown[]>([after.amount, after.version]).toEqual([2_488_000n, 2])
    expect(
      await codeOf(() => replace.execute(manager, charge.id, { lines: LINES, version: 1 })),
    ).toBe('version_conflict')
  })

  test('FR-02.2 two replaces of the same version released together: exactly one wins', async () => {
    const { manager, charge } = await draftWithCharge()
    const replace = finance.useCases.replaceDraftCharge
    let release!: () => void
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const racer = async (lines: typeof LINES) => {
      await barrier
      return codeOf(() => replace.execute(manager, charge.id, { lines, version: 1 }))
    }
    const runs = [racer(LINES.slice(0, 1)), racer(LINES.slice(0, 2))]
    release()
    const outcomes = (await Promise.all(runs)).sort()
    expect(outcomes).toEqual(['ok', 'version_conflict'])
    const rows = await db.sql<
      { version: number }[]
    >`SELECT version FROM finance.charge WHERE id = ${charge.id}`
    expect(rows[0]?.version).toBe(2)
  })

  test('a total of zero or less is 422 charge_total_zero; a broken line names lines[i]; a Guard is 403', async () => {
    const { manager, charge } = await draftWithCharge()
    const replace = finance.useCases.replaceDraftCharge
    const offset = [
      { itemName: { vi: 'Phí' }, unitPrice: 100_000 },
      {
        kind: 'adjustment' as const,
        itemName: { vi: 'Giảm' },
        amount: -100_000,
        note: 'Miễn phí tháng này',
      },
    ]
    expect(
      await codeOf(() => replace.execute(manager, charge.id, { lines: offset, version: 1 })),
    ).toBe('validation_failed:charge_total_zero')
    let broken: unknown
    try {
      await replace.execute(manager, charge.id, {
        lines: [
          { itemName: { vi: 'Nước' }, quantity: '12.345', unitPrice: 15_000, amount: 185_000 },
        ],
        version: 1,
      })
    } catch (error) {
      broken = error
    }
    expect((broken as { details?: unknown }).details).toEqual([
      { path: 'lines[0].amount', code: 'amount_mismatch', message: 'amount_mismatch' },
    ])
    expect(
      await codeOf(() =>
        replace.execute(staff('guard', manager.buildingId), charge.id, {
          lines: LINES,
          version: 1,
        }),
      ),
    ).toBe('forbidden')
  })

  test('remove: the charge and its lines go; a stale version is 409; the audit rows are finance.charge.update', async () => {
    const { manager, batch, charge } = await draftWithCharge()
    const remove = finance.useCases.removeDraftCharge
    expect(await codeOf(() => remove.execute(manager, charge.id, 9))).toBe('version_conflict')
    await remove.execute(manager, charge.id, 1)
    expect(await finance.queries.feeBatches.charges(manager.scope, batch.id)).toEqual([])
    const lines = await db.sql`SELECT 1 FROM finance.charge_line WHERE charge_id = ${charge.id}`
    expect(lines).toHaveLength(0)
    const audit =
      await db.sql`SELECT action, details FROM audit.audit_log WHERE object_id = ${charge.id} ORDER BY at, id`
    expect(audit.map((row) => [row.action, (row.details as { op: string }).op])).toEqual([
      ['finance.charge.update', 'add'],
      ['finance.charge.update', 'remove'],
    ])
  })

  test('discard of a draft with a charge deletes both and reports chargeCount 1', async () => {
    const { manager, batch } = await draftWithCharge()
    const fresh = await finance.queries.feeBatches.batch(manager.scope, batch.id)
    const discarded = await finance.useCases.discardFeeBatch.execute(
      manager,
      batch.id,
      fresh.version,
    )
    expect(discarded.chargeCount).toBe(1)
    const charges = await db.sql`SELECT 1 FROM finance.charge WHERE batch_id = ${batch.id}`
    expect(charges).toHaveLength(0)
  })
})
