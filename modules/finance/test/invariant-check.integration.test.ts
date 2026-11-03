import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import type { JobContext } from '@core/runtime'
import { FakeClock } from '@core/testing'
import { cloneDatabase, type TestDb } from '@rms/test-support'
import { sql } from 'drizzle-orm'
import type postgres from 'postgres'
import type { InvariantTag } from '../src/domain/invariant-check'
import { invariantCheckJob } from '../src/infrastructure/jobs/invariant-check'
import { DrizzleInvariantReader } from '../src/infrastructure/persistence/drizzle-invariant-reader'
import { createAllocationHarness } from './support'

/**
 * The nightly ledger check against a real database (DOC-22 §12, §16.7, LG-54…LG-59; EXP-11 §3 K01…K19 as the regression
 * guard of the nightly stage, DOC-100). A building is made by the ledger code (cash and online payments of one and of two charges,
 * an open charge), cloned once per corruption, and each corruption is injected as `rms_migrator` with the guard triggers of the
 * tables off (`DISABLE TRIGGER USER`; `session_replication_role` needs a superuser) and a constraint or an index dropped where
 * the database would have refused the row. The expected sets are the column "expected to fire" of EXP-11 §3. K20…K22 belong to
 * `integrity_weekly` and `integrity_notices` (DOC-27, DOC-31) and are not here.
 */

type Tx = postgres.TransactionSql

interface Facts {
  readonly a: string
  readonly b: string
  /** A cash payment of one charge: its charge, allocation, payment, receipt, unit. */
  readonly single: Record<'charge' | 'alloc' | 'payment' | 'receipt' | 'unit', string>
  /** A cash payment of two charges. */
  readonly cash: Record<'charge' | 'alloc' | 'payment' | 'receipt' | 'unit', string>
  /** An online payment of two charges. */
  readonly online: Record<'charge' | 'alloc' | 'payment' | 'intent' | 'event' | 'unit', string>
  /** An open charge. */
  readonly open: Record<'charge' | 'unit', string>
}

const GUARDED = [
  'charge',
  'charge_line',
  'payment',
  'allocation',
  'receipt',
  'gateway_event',
  'payment_intent',
  'payment_intent_item',
  'document_counter',
]

let base: TestDb
let facts: Facts
const clones: TestDb[] = []

/** The first row of a query, as strings. */
async function first(
  h: Awaited<ReturnType<typeof createAllocationHarness>>,
  text: string,
): Promise<Record<string, string>> {
  const rows = (await h.database.executor.execute(sql.raw(text))) as unknown as Array<
    Record<string, string>
  >
  const row = rows[0]
  if (!row) throw new Error(`no row for: ${text}`)
  return row
}

beforeAll(async () => {
  const h = await createAllocationHarness()
  const A = h.newBuilding()
  const B = h.newBuilding()
  const singles = await h.seedOpenCharges(A, 2)
  const pairs = await h.seedPairs(A, 3)
  for (const single of singles) await h.manualPay(A, [single.id])
  await h.manualPay(A, [...(pairs[0] ?? [])])
  await h.onlinePay(A, [...(pairs[1] ?? [])])
  const pairB = await h.seedPairs(B, 1)
  await h.manualPay(B, [...(pairB[0] ?? [])])
  const a = A.buildingId
  const paid = (extra: string) =>
    `select c.id as charge, a.id as alloc, a.payment_id as payment, r.id as receipt, c.unit_id as unit, p.intent_id as intent,
       (select g.id from finance.gateway_event g where g.payment_id = p.id limit 1) as event
     from finance.charge c join finance.allocation a on a.charge_id = c.id join finance.payment p on p.id = a.payment_id
     join finance.receipt r on r.allocation_id = a.id
     where c.building_id = '${a}' and ${extra} order by c.id limit 1`
  const single = await first(h, paid(`p.source = 'cash' and p.amount = c.amount`))
  const cash = await first(h, paid(`p.source = 'cash' and p.amount > c.amount`))
  const online = await first(h, paid(`p.source = 'online'`))
  const open = await first(
    h,
    `select id as charge, unit_id as unit from finance.charge where building_id = '${a}' and status = 'open' order by id limit 1`,
  )
  facts = {
    a,
    b: B.buildingId,
    single: single as Facts['single'],
    cash: cash as Facts['cash'],
    online: online as Facts['online'],
    open: open as Facts['open'],
  }
  // A template can be copied only when nobody is connected to it.
  await h.database.close()
  base = h.db
})

afterAll(async () => {
  for (const clone of clones) await clone.drop().catch(() => {})
  await base.drop().catch(() => {})
})

/** Runs `inject` on a fresh copy of the seeded database and answers the queries that returned rows, per building. */
async function inject(
  run: (tx: Tx, f: Facts) => Promise<void>,
): Promise<{ clone: TestDb; fired: (building: string) => Promise<Record<string, number>> }> {
  const clone = await cloneDatabase(base)
  clones.push(clone)
  const admin = clone.admin(1)
  try {
    await admin.begin(async (tx) => {
      for (const table of GUARDED)
        await tx.unsafe(`ALTER TABLE finance.${table} DISABLE TRIGGER USER`)
      await run(tx, facts)
    })
  } finally {
    await admin.end()
  }
  const database = new Database({ url: clone.url, poolMax: 2, prepare: false })
  const reader = new DrizzleInvariantReader(database)
  return {
    clone,
    fired: async (building) => {
      const found = await database.transaction(() => reader.check(building), {
        isolationLevel: 'repeatable read',
        accessMode: 'read only',
      })
      await database.close()
      return Object.fromEntries(found.map((finding) => [finding.tag, finding.rows]))
    },
  }
}

/** A copy of one row with some columns replaced: `copy(tx, 'payment', id, { id: 'gen_random_uuid()' })`. */
async function copyRow(
  tx: Tx,
  table: string,
  id: string,
  set: Record<string, string>,
): Promise<void> {
  const assignments = Object.entries(set)
    .map(([column, value]) => `${column} = ${value}`)
    .join(', ')
  await tx.unsafe(
    `CREATE TEMP TABLE copy_row ON COMMIT DROP AS SELECT * FROM finance.${table} WHERE id = '${id}'`,
  )
  await tx.unsafe(`UPDATE copy_row SET ${assignments}`)
  await tx.unsafe(`INSERT INTO finance.${table} SELECT * FROM copy_row`)
  await tx.unsafe('DROP TABLE copy_row')
}

const NEW_ID = 'gen_random_uuid()'

/** K01…K19 of EXP-11 §3: the corruption and the set of queries it makes fire. */
const CORRUPTIONS: ReadonlyArray<{
  k: string
  what: string
  expected: readonly InvariantTag[]
  run: (tx: Tx, f: Facts) => Promise<void>
}> = [
  {
    k: 'K01',
    what: 'a paid charge whose allocation is 1 đ short',
    expected: ['Q01', 'Q08'],
    run: async (tx, f) => {
      await tx.unsafe(
        `UPDATE finance.allocation SET amount = amount - 1 WHERE id = '${f.cash.alloc}'`,
      )
    },
  },
  {
    k: 'K02',
    what: 'a payment voided, its allocations left live',
    expected: ['Q02'],
    run: async (tx, f) => {
      await tx.unsafe(
        `UPDATE finance.payment SET status = 'void', voided_at = now(), voided_by = gen_random_uuid(), void_reason = 'injected by K02' WHERE id = '${f.cash.payment}'`,
      )
    },
  },
  {
    k: 'K03',
    what: 'a charge voided, its allocation left live',
    expected: ['Q03'],
    run: async (tx, f) => {
      await tx.unsafe(
        `UPDATE finance.charge SET status = 'void', void_kind = 'recall', voided_at = now(), voided_by = gen_random_uuid() WHERE id = '${f.single.charge}'`,
      )
    },
  },
  {
    k: 'K04',
    what: 'two live allocations on one charge',
    expected: ['Q04', 'Q17'],
    run: async (tx, f) => {
      await tx.unsafe('DROP INDEX finance.uq_allocation_charge_live')
      await tx.unsafe(`SELECT 1`)
      await copyRow(tx, 'payment', f.single.payment, {
        id: "'00000000-0000-7000-8000-0000000000a1'",
        client_key: NEW_ID,
      })
      await copyRow(tx, 'allocation', f.single.alloc, {
        id: NEW_ID,
        payment_id: "'00000000-0000-7000-8000-0000000000a1'",
      })
    },
  },
  {
    k: 'K05',
    what: 'a receipt deleted, the counter kept',
    expected: ['Q05', 'Q17'],
    run: async (tx, f) => {
      await tx.unsafe(`DELETE FROM finance.receipt WHERE id = '${f.single.receipt}'`)
    },
  },
  {
    k: 'K06',
    what: 'two receipts for one allocation',
    expected: ['Q06'],
    run: async (tx, f) => {
      await tx.unsafe('ALTER TABLE finance.receipt DROP CONSTRAINT uq_receipt_building_allocation')
      const [{ last }] = (await tx.unsafe(
        `SELECT last FROM finance.document_counter WHERE building_id = '${f.a}' AND series = 'receipt'`,
      )) as unknown as [{ last: number }]
      const number = `'BL-2610-${String(last + 1).padStart(4, '0')}'`
      await copyRow(tx, 'receipt', f.single.receipt, { id: NEW_ID, number })
      await tx.unsafe(
        `UPDATE finance.document_counter SET last = last + 1 WHERE building_id = '${f.a}' AND series = 'receipt'`,
      )
    },
  },
  {
    k: 'K07',
    what: 'an allocation voided, its receipt left issued',
    expected: ['Q07', 'Q08', 'Q14'],
    run: async (tx, f) => {
      await tx.unsafe(
        `UPDATE finance.allocation SET status = 'void', voided_at = now() WHERE id = '${f.single.alloc}'`,
      )
    },
  },
  {
    k: 'K08',
    what: 'a payment 1 đ above its allocations',
    expected: ['Q08'],
    run: async (tx, f) => {
      await tx.unsafe(
        `UPDATE finance.payment SET amount = amount + 1 WHERE id = '${f.cash.payment}'`,
      )
    },
  },
  {
    k: 'K09',
    what: 'a posted log row without a payment',
    expected: ['Q09'],
    run: async (tx, f) => {
      await tx.unsafe('ALTER TABLE finance.gateway_event DROP CONSTRAINT ck_gateway_event_posted')
      await copyRow(tx, 'gateway_event', f.online.event, {
        id: NEW_ID,
        reference: "'FT9000000009'",
        outcome: "'posted'",
        payment_id: 'NULL',
      })
    },
  },
  {
    k: 'K10',
    what: 'a payment moved to another unit',
    expected: ['Q10'],
    run: async (tx, f) => {
      await tx.unsafe(
        `UPDATE finance.payment SET unit_id = '${f.open.unit}' WHERE id = '${f.cash.payment}'`,
      )
    },
  },
  {
    k: 'K11',
    what: 'an intent paid with no payment',
    expected: ['Q11'],
    run: async (tx, f) => {
      await copyRow(tx, 'payment_intent', f.online.intent, {
        id: NEW_ID,
        code: "'TT-261019-9011'",
        order_code: 'order_code + 1000',
        link_id: "'link-k11'",
        gateway_reference: "'FT9000000011'",
      })
    },
  },
  {
    k: 'K12',
    what: 'an online payment without its intent',
    expected: ['Q12'],
    run: async (tx, f) => {
      await tx.unsafe('ALTER TABLE finance.payment DROP CONSTRAINT ck_payment_online')
      await tx.unsafe(
        `UPDATE finance.payment SET source = 'online', provider = 'payos', gateway_reference = 'pi_k12', intent_id = NULL, client_key = NULL, recorded_by = NULL WHERE id = '${f.cash.payment}'`,
      )
    },
  },
  {
    k: 'K13',
    what: 'two active intents on one charge',
    expected: ['Q13'],
    run: async (tx, f) => {
      await tx.unsafe('DROP INDEX finance.uq_payment_intent_item_charge_active')
      const second = '00000000-0000-7000-8000-0000000000b2'
      await copyRow(tx, 'payment_intent', f.online.intent, {
        id: `'${second}'`,
        code: "'TT-261019-9013'",
        order_code: 'order_code + 1000',
        link_id: "'link-k13'",
        status: "'pending'",
        paid_at: 'NULL',
        gateway_reference: 'NULL',
      })
      for (const intent of [f.online.intent, second])
        await tx.unsafe(
          `INSERT INTO finance.payment_intent_item (id, building_id, intent_id, charge_id, amount) VALUES (gen_random_uuid(), '${f.a}', '${intent}', '${f.open.charge}', 100000)`,
        )
    },
  },
  {
    k: 'K14',
    what: 'a charge set paid with no allocation',
    expected: ['Q14'],
    run: async (tx, f) => {
      await tx.unsafe(`UPDATE finance.charge SET status = 'paid' WHERE id = '${f.open.charge}'`)
    },
  },
  {
    k: 'K15',
    what: 'a charge reopened with its allocation live',
    expected: ['Q15'],
    run: async (tx, f) => {
      await tx.unsafe(`UPDATE finance.charge SET status = 'open' WHERE id = '${f.single.charge}'`)
    },
  },
  {
    k: 'K16',
    what: 'the counter below the highest issued number',
    expected: ['Q05', 'Q16'],
    run: async (tx, f) => {
      await tx.unsafe(
        `UPDATE finance.document_counter SET last = last - 2 WHERE building_id = '${f.a}' AND series = 'receipt'`,
      )
    },
  },
  {
    k: 'K17',
    what: 'a live allocation without a receipt (the highest number deleted, the counter lowered to match)',
    expected: ['Q17'],
    run: async (tx, f) => {
      await tx.unsafe(
        `DELETE FROM finance.receipt WHERE id = (SELECT id FROM finance.receipt WHERE building_id = '${f.a}' ORDER BY number DESC LIMIT 1)`,
      )
      await tx.unsafe(
        `UPDATE finance.document_counter SET last = last - 1 WHERE building_id = '${f.a}' AND series = 'receipt'`,
      )
    },
  },
  {
    k: 'K18',
    what: 'a line deleted from a paid charge',
    expected: ['Q18'],
    run: async (tx, f) => {
      await tx.unsafe(`DELETE FROM finance.charge_line WHERE charge_id = '${f.cash.charge}'`)
    },
  },
  {
    k: 'K19',
    what: 'a committed log row still pending',
    expected: ['Q19'],
    run: async (tx, f) => {
      await copyRow(tx, 'gateway_event', f.online.event, {
        id: NEW_ID,
        reference: "'FT9000000019'",
        outcome: "'pending'",
        payment_id: 'NULL',
      })
    },
  },
]

describe('the nightly ledger check (DOC-22 §12, LG-54…LG-59, EXP-11 K01…K19)', () => {
  test('LG-54 the 19 queries return 0 rows on a building made by the ledger code, and on the second building', async () => {
    const { fired } = await inject(async () => {})
    expect(await fired(facts.a)).toEqual({})
  })

  for (const corruption of CORRUPTIONS) {
    test(`LG-55 ${corruption.k}: ${corruption.what} fires exactly ${corruption.expected.join(', ')} for its building and nothing for the other`, async () => {
      const injected = await inject(corruption.run)
      const reader = new DrizzleInvariantReader(
        new Database({ url: injected.clone.url, poolMax: 2, prepare: false }),
      )
      const other = await reader.check(facts.b)
      expect(other).toEqual([])
      const fired = await injected.fired(facts.a)
      expect(Object.keys(fired).sort()).toEqual([...corruption.expected].sort())
    })
  }

  test('LG-56 the job reports the rows as details.violations, succeeds, and repairs nothing', async () => {
    const injected = await inject(CORRUPTIONS[7]?.run ?? (async () => {}))
    const database = new Database({ url: injected.clone.url, poolMax: 2, prepare: false })
    const digest = async () =>
      (await database.executor.execute(
        sql`select md5(string_agg(t::text, '|' order by t::text)) as d from (
          select id::text || amount::text || status as t from finance.payment
          union all select id::text || amount::text || status from finance.allocation
          union all select id::text || number || status from finance.receipt
          union all select id::text || amount::text || status from finance.charge) x`,
      )) as unknown as Array<{ d: string }>
    const before = await digest()
    const context = {
      clock: new FakeClock(new Date('2026-11-03T20:00:00Z')),
      signal: new AbortController().signal,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      manual: false,
      paused: () => false,
      buildings: async () => [],
      withLock: <T>(fn: () => Promise<T>) => fn(),
      snapshot: <T>(fn: () => Promise<T>) =>
        database.transaction(fn, { isolationLevel: 'repeatable read', accessMode: 'read only' }),
    } as unknown as JobContext
    const job = invariantCheckJob(
      new DrizzleInvariantReader(database),
      { liveBuildingIds: async () => [facts.a, facts.b] },
      720,
    )
    const result = await job.run(context)
    expect(result.details).toMatchObject({ queries: 19, violations: 1, perQuery: { Q08: 1 } })
    expect(await digest()).toEqual(before)
    await database.close()
  })

  test('LG-58 a corruption committed during the run is not seen by its snapshot', async () => {
    const clone = await cloneDatabase(base)
    clones.push(clone)
    const database = new Database({ url: clone.url, poolMax: 4, prepare: false })
    const admin = clone.admin(1)
    const reader = new DrizzleInvariantReader(database)
    const inside = await database.transaction(
      async () => {
        const firstRead = await reader.check(facts.a)
        await admin.unsafe(`ALTER TABLE finance.payment DISABLE TRIGGER USER`)
        await admin.unsafe(
          `UPDATE finance.payment SET amount = amount + 1 WHERE id = '${facts.cash.payment}'`,
        )
        return { firstRead, secondRead: await reader.check(facts.a) }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
    expect(inside.firstRead).toEqual([])
    expect(inside.secondRead).toEqual([])
    expect((await reader.check(facts.a)).map((finding) => finding.tag)).toEqual(['Q08'])
    await admin.end()
    await database.close()
  })

  test('LG-59 an allocation inserted past the predicate is refused while the index exists', async () => {
    const clone = await cloneDatabase(base)
    clones.push(clone)
    const admin = clone.admin(1)
    const insert = admin.begin(async (tx) => {
      await tx.unsafe(`ALTER TABLE finance.allocation DISABLE TRIGGER USER`)
      await copyRow(tx, 'payment', facts.single.payment, {
        id: "'00000000-0000-7000-8000-0000000000a2'",
        client_key: NEW_ID,
      })
      await copyRow(tx, 'allocation', facts.single.alloc, {
        id: NEW_ID,
        payment_id: "'00000000-0000-7000-8000-0000000000a2'",
      })
    })
    await expect(insert).rejects.toMatchObject({ code: '23505' })
    await admin.end()
  })
})
