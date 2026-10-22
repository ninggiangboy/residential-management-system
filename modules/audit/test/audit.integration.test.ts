import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { requestContext } from '@core/context'
import { Database } from '@core/db'
import { UuidV7Generator } from '@core/kernel'
import type { JobContext } from '@core/runtime'
import type { BuildingId, StaffContext, StaffId } from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { sql } from 'drizzle-orm'
import { auditActionCatalogOf } from '../src/application/action-catalog'
import { AuditApiImpl } from '../src/application/api/audit-api-impl'
import { createAudited } from '../src/application/audited'
import { RecordAuditEntry } from '../src/application/use-cases/record-audit-entry'
import { NoTransactionError, UndeclaredAuditActionError } from '../src/domain/errors'
import { auditPurgeJob } from '../src/infrastructure/jobs/audit-purge'
import { DrizzleAuditLogRepository } from '../src/infrastructure/persistence/drizzle-audit-log-repository'
import { requestInfoFromContext } from '../src/infrastructure/request-info'
import inventory from './personal-columns.json'

const building = '018f0000-0000-7000-8000-000000000001' as BuildingId
const staff: StaffContext = {
  buildingId: building,
  staffId: '018f0000-0000-7000-8000-0000000000a1' as StaffId,
  role: 'manager',
  scope: { buildingId: building },
}
const paymentId = '018f0000-0000-7000-8000-0000000000b1'
const ids = new UuidV7Generator()

let db: TestDb
let database: Database
let writer: AuditApiImpl
let audited: ReturnType<typeof createAudited>

beforeAll(async () => {
  db = await cloneTemplate('empty')
  const admin = db.admin()
  // The mutation the audit row belongs to: a table of a module that does not exist yet.
  await admin.unsafe(`
    CREATE SCHEMA scratch;
    CREATE TABLE scratch.payment (id uuid PRIMARY KEY, status text NOT NULL);
    GRANT USAGE ON SCHEMA scratch TO rms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON scratch.payment TO rms_app;
    INSERT INTO scratch.payment VALUES ('${paymentId}', 'posted');`)
  await admin.end()
  database = new Database({ url: db.url, poolMax: 10, prepare: false })
  writer = new AuditApiImpl(
    new RecordAuditEntry({
      repository: new DrizzleAuditLogRepository(database),
      transaction: database,
      ids,
      actions: auditActionCatalogOf([
        { name: 'finance', auditActions: ['finance.payment.void', 'finance.payment.post'] },
      ]),
      requestInfo: requestInfoFromContext,
      logger: { info() {}, warn() {}, error() {} },
    }),
  )
  audited = createAudited(writer)
  voidPayment = audited(
    {
      action: 'finance.payment.void',
      object: (r: { id: string }) => ({ type: 'payment', id: r.id }),
      reason: (_actor, cmd: { reason: string }) => cmd.reason,
    },
    async (_actor: StaffContext, _cmd: { reason: string }) => {
      await database.executor.execute(
        sql`UPDATE scratch.payment SET status = 'void' WHERE id = ${paymentId}`,
      )
      return {
        result: { id: paymentId },
        changes: [{ field: 'status', before: 'posted', after: 'void' }],
      }
    },
  )
})
afterAll(async () => {
  await database.close()
  await db.drop()
})

const rowsOf = (action = 'finance.payment.void') =>
  db.sql`SELECT * FROM audit.audit_log WHERE action = ${action} ORDER BY id`

let voidPayment: (staff: StaffContext, cmd: { reason: string }) => Promise<{ id: string }>
const resetPayment = () => db.sql`UPDATE scratch.payment SET status = 'posted'`
const paymentStatus = async () => (await db.sql`SELECT status FROM scratch.payment`)[0]?.status
const clearLog = async () => {
  const admin = db.admin()
  await admin.unsafe(`SET audit.purging = 'on'; DELETE FROM audit.audit_log`)
  await admin.end()
}

describe('the audit row joins the mutation (ADR-0018, DOC-35 §3.7)', () => {
  test('AD-01 a use case that writes its change and its audit row, then throws, leaves neither', async () => {
    await resetPayment()
    await clearLog()
    // the body throws after its change; `audited` never reaches record, so also try the order the other way round:
    await expect(
      database.run(async () => {
        await voidPayment(staff, { reason: 'wrong unit' })
        throw new Error('the transaction fails after the audit row was written')
      }),
    ).rejects.toThrow('the transaction fails')
    expect(await paymentStatus()).toBe('posted')
    expect(await rowsOf()).toHaveLength(0)
  })

  test('AD-02 a committed mutation leaves exactly one row, written at the start of its transaction', async () => {
    await resetPayment()
    await clearLog()
    let started: Date | undefined
    await database.run(async () => {
      const rows = await database.executor.execute<{ t: Date }>(
        sql`SELECT transaction_timestamp() AS t`,
      )
      started = new Date(rows[0]?.t as Date)
      await requestContext.run({ requestId: 'req-ad-02', correlationId: 'c' }, () =>
        voidPayment(staff, { reason: 'wrong unit' }),
      )
    })
    const rows = await rowsOf()
    expect(rows).toHaveLength(1)
    expect(new Date(rows[0]?.at).getTime()).toBe(started?.getTime() as number)
    expect(await paymentStatus()).toBe('void')
  })

  test('AD-03 when the audit insert fails the mutation fails and the changed row is unchanged', async () => {
    await resetPayment()
    const admin = db.admin()
    await admin.unsafe('ALTER TABLE audit.audit_log RENAME TO audit_log_away')
    try {
      await expect(
        database.run(() => voidPayment(staff, { reason: 'wrong unit' })),
      ).rejects.toBeDefined()
    } finally {
      await admin.unsafe('ALTER TABLE audit.audit_log_away RENAME TO audit_log')
      await admin.end()
    }
    expect(await paymentStatus()).toBe('posted')
  })

  test('AD-04 record with no open transaction throws NoTransactionError', async () => {
    await expect(
      writer.record({
        actor: staff,
        action: 'finance.payment.void',
        object: { type: 'payment', id: paymentId },
        changes: [],
        reason: 'wrong unit',
      }),
    ).rejects.toBeInstanceOf(NoTransactionError)
  })

  test('AD-05 an undeclared action is refused and nothing is written', async () => {
    await clearLog()
    await expect(
      database.run(() =>
        writer.record({
          actor: staff,
          action: 'finance.payment.destroy',
          object: { type: 'payment', id: paymentId },
          changes: [],
        }),
      ),
    ).rejects.toBeInstanceOf(UndeclaredAuditActionError)
    expect(await rowsOf('finance.payment.destroy')).toHaveLength(0)
  })

  test('AD-07 a void with the reason "wrong unit" stores actor, role, IP, request id, object, changes, reason and time', async () => {
    await resetPayment()
    await clearLog()
    await database.run(() =>
      requestContext.run(
        {
          requestId: 'req-ad-07',
          correlationId: 'c',
          ip: '203.0.113.9',
          userAgent: 'RmsCms/1.0 (Macintosh)',
        },
        () => voidPayment(staff, { reason: 'wrong unit' }),
      ),
    )
    const [row] = await rowsOf()
    expect(row).toMatchObject({
      building_id: building,
      actor_kind: 'staff',
      actor_id: staff.staffId,
      actor_role: 'manager',
      ip: '203.0.113.9',
      user_agent: 'RmsCms/1.0 (Macintosh)',
      request_id: 'req-ad-07',
      action: 'finance.payment.void',
      object_type: 'payment',
      object_id: paymentId,
      changes: [{ field: 'status', before: 'posted', after: 'void' }],
      details: {},
      reason: 'wrong unit',
    })
    expect(row?.at).toBeInstanceOf(Date)
  })

  test('AD-08 a reason of 4 characters writes no row and runs no statement of the body', async () => {
    await resetPayment()
    await clearLog()
    await expect(database.run(() => voidPayment(staff, { reason: 'four' }))).rejects.toBeDefined()
    expect(await paymentStatus()).toBe('posted')
    expect(await rowsOf()).toHaveLength(0)
  })

  test('AD-14 a system row is stored with no actor id and no role', async () => {
    await clearLog()
    await database.run(() =>
      writer.record({
        actor: { kind: 'system', source: 'webhook', buildingId: building },
        action: 'finance.payment.post',
        object: { type: 'payment', id: paymentId },
        changes: [],
        details: { source: 'webhook' },
      }),
    )
    const [row] = await rowsOf('finance.payment.post')
    expect(row).toMatchObject({
      actor_kind: 'system',
      actor_id: null,
      actor_role: null,
      request_id: null,
    })
    expect(row?.details).toEqual({ source: 'webhook' })
  })

  test('AD-27 two rows of one transaction share their time and are ordered by id', async () => {
    await clearLog()
    await database.run(async () => {
      for (let i = 0; i < 3; i++)
        await writer.record({
          actor: staff,
          action: 'finance.payment.void',
          object: { type: 'payment', id: paymentId },
          changes: [{ field: 'step', before: i, after: i + 1 }],
          reason: 'twice in one go',
        })
    })
    const rows = await rowsOf()
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((r) => new Date(r.at).getTime())).size).toBe(1)
    expect(rows.map((r) => r.changes[0].before)).toEqual([0, 1, 2])
  })
})

describe('the log cannot be edited by the application (DR-57, DOC-17 §2)', () => {
  test('AD-17 rms_app can read and insert but UPDATE, DELETE and TRUNCATE fail with 42501', async () => {
    await clearLog()
    await database.run(() =>
      writer.record({
        actor: staff,
        action: 'finance.payment.void',
        object: { type: 'payment', id: paymentId },
        changes: [],
        reason: 'to be kept',
      }),
    )
    expect((await db.sql`SELECT count(*)::int AS n FROM audit.audit_log`)[0]?.n).toBe(1)
    for (const statement of [
      "UPDATE audit.audit_log SET reason = 'edited'",
      'DELETE FROM audit.audit_log',
      'TRUNCATE audit.audit_log',
    ])
      await expect((async () => db.sql.unsafe(statement))()).rejects.toMatchObject({
        code: '42501',
      })
    expect((await db.sql`SELECT count(*)::int AS n FROM audit.audit_log`)[0]?.n).toBe(1)
  })

  test('the trigger refuses an update, a delete and a truncate even from the table owner', async () => {
    const admin = db.admin()
    try {
      for (const statement of [
        "UPDATE audit.audit_log SET reason = 'edited'",
        'DELETE FROM audit.audit_log',
        'TRUNCATE audit.audit_log',
      ])
        await expect((async () => admin.unsafe(statement))()).rejects.toMatchObject({
          code: '23000',
        })
    } finally {
      await admin.end()
    }
  })

  test('the constraints of DOC-17 §2 hold: a system row with an actor, a staff row without a role, a bad action, a non-array', async () => {
    const admin = db.admin()
    const base = `'${ids.next()}', '${building}'`
    const insert = async (
      kind: string,
      actorId: string,
      role: string,
      action: string,
      changes = "'[]'",
    ) =>
      await admin.unsafe(
        `INSERT INTO audit.audit_log (id, building_id, actor_kind, actor_id, actor_role, action, object_type, object_id, changes)
         VALUES (${base}, '${kind}', ${actorId}, ${role}, '${action}', 'x', '${paymentId}', ${changes})`,
      )
    try {
      await expect(insert('system', `'${staff.staffId}'`, 'NULL', 'a.b.c')).rejects.toMatchObject({
        constraint_name: 'ck_audit_log_actor',
      })
      await expect(insert('staff', `'${staff.staffId}'`, 'NULL', 'a.b.c')).rejects.toMatchObject({
        constraint_name: 'ck_audit_log_role',
      })
      await expect(
        insert('staff', `'${staff.staffId}'`, "'admin'", 'Bad.Action'),
      ).rejects.toMatchObject({
        constraint_name: 'ck_audit_log_action',
      })
      await expect(
        insert('staff', `'${staff.staffId}'`, "'admin'", 'a.b.c', "'{}'"),
      ).rejects.toMatchObject({
        constraint_name: 'ck_audit_log_changes',
      })
    } finally {
      await admin.end()
    }
  })

  test('S-AD-9 retention_class is generated from the action: finance.* is finance, the rest standard', async () => {
    await clearLog()
    await database.run(async () => {
      await writer.record({
        actor: staff,
        action: 'finance.payment.void',
        object: { type: 'payment', id: paymentId },
        changes: [],
        reason: 'for the class',
      })
      await writer.record({
        actor: staff,
        action: 'pii.read',
        object: { type: 'resident_profile', id: paymentId },
        changes: [],
        details: { view: 'detail' },
      })
    })
    const rows = await db.sql`SELECT action, retention_class FROM audit.audit_log ORDER BY action`
    expect(rows.map((r) => [r.action, r.retention_class])).toEqual([
      ['finance.payment.void', 'finance'],
      ['pii.read', 'standard'],
    ])
  })
})

describe('the purge (DR-110, DOC-17 §2)', () => {
  async function seedAged() {
    await clearLog()
    const admin = db.admin()
    const aged = [
      ['finance', '5 years 1 day'],
      ['finance', '4 years'],
      ['standard', '2 years 1 day'],
      ['standard', '1 year'],
    ] as const
    for (const [scope, age] of aged)
      await admin.unsafe(
        `INSERT INTO audit.audit_log (id, building_id, actor_kind, action, object_type, object_id, at)
         VALUES ('${ids.next()}', '${building}', 'system', '${scope === 'finance' ? 'finance.payment.post' : 'residency.unit.update'}',
                 'x', '${paymentId}', now() - interval '${age}')`,
      )
    await admin.end()
  }
  const remaining = async () =>
    (await db.sql`SELECT retention_class AS c, now() - at AS age FROM audit.audit_log ORDER BY at`)
      .length

  test('AD-18 audit.purge(now(), …) deletes the finance row older than 5 years and the standard row older than 2', async () => {
    await seedAged()
    const finance = await db.sql`SELECT audit.purge(now(), 'finance') AS n`
    const standard = await db.sql`SELECT audit.purge(now(), 'standard') AS n`
    expect([Number(finance[0]?.n), Number(standard[0]?.n)]).toEqual([1, 1])
    expect(await remaining()).toBe(2)
  })

  test('AD-19 a cut-off in the year 2100 is clamped to the floor: the newer rows stay', async () => {
    await seedAged()
    const finance = await db.sql`SELECT audit.purge('2100-01-01', 'finance') AS n`
    const standard = await db.sql`SELECT audit.purge('2100-01-01', 'standard') AS n`
    expect([Number(finance[0]?.n), Number(standard[0]?.n)]).toEqual([1, 1])
    expect(await remaining()).toBe(2)
  })

  test('an unknown scope is refused, and the flag that lets a delete through does not outlive the function', async () => {
    await expect(
      (async () => db.sql`SELECT audit.purge(now(), 'everything')`)(),
    ).rejects.toMatchObject({ code: '22023' })
    await seedAged()
    await db.sql`SELECT audit.purge(now(), 'finance')`
    const admin = db.admin()
    try {
      await expect(
        (async () => admin.unsafe('DELETE FROM audit.audit_log'))(),
      ).rejects.toMatchObject({ code: '23000' })
    } finally {
      await admin.end()
    }
  })

  test('the audit_purge job runs both scopes under the job lock and reports the counts', async () => {
    await seedAged()
    const job = auditPurgeJob(database, 10_080)
    expect(job).toMatchObject({
      name: 'audit_purge',
      mode: 'lock',
      schedule: { kind: 'monthly', day: 1, at: '04:30' },
    })
    const ctx = {
      clock: { now: () => new Date() },
      withLock: <T>(fn: () => Promise<T>) => database.transaction(fn),
    } as unknown as JobContext
    expect(await job.run(ctx)).toEqual({ did: 2, details: { finance: 1, standard: 1 } })
    expect(await remaining()).toBe(2)
  })
})

describe('the inventory of personal columns (DOC-35 §7.3)', () => {
  const PERSONAL =
    /phone|email|cccd|birth|full_name|display_name|payer_name|plate|(^|_)ip$|user_agent|avatar|note/
  const key = (schema: string, table: string, column: string) => `${schema}.${table}.${column}`
  const listed = new Set(inventory.columns.map((c) => key(c.schema, c.table, c.column)))

  async function columns() {
    return db.sql`
      SELECT table_schema AS schema, table_name AS "table", column_name AS "column"
        FROM information_schema.columns
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'drizzle\\_%'
         AND table_schema <> 'scratch'`
  }

  test('AD-30 every column whose name looks personal is in the inventory', async () => {
    const missing = (await columns())
      .filter((c) => PERSONAL.test(c.column))
      .map((c) => key(c.schema, c.table, c.column))
      .filter((k) => !listed.has(k))
    expect(missing).toEqual([])
  })

  test('AD-31 an inventory entry for a migrated module names a column that exists', async () => {
    const migrated = new Set(
      (
        await db.sql`SELECT schema_name AS s FROM information_schema.schemata WHERE schema_name LIKE 'drizzle\\_%'`
      ).map((r) => String(r.s).slice('drizzle_'.length)),
    )
    const existing = new Set((await columns()).map((c) => key(c.schema, c.table, c.column)))
    const dangling = inventory.columns
      .filter((c) => migrated.has(c.schema))
      .map((c) => key(c.schema, c.table, c.column))
      .filter((k) => !existing.has(k))
    expect(dangling).toEqual([])
  })
})
