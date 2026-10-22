import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import type { Sql } from 'postgres'

/**
 * The DDL tests of DOC-17 §13: each statement runs as `rms_migrator` in a transaction that is rolled back, and its SQLSTATE is
 * compared with the table. `23505` unique, `23514` check, `23503` foreign key, `23000` raised by a trigger, `428C9` generated
 * column, `22023` bad argument. They run on the tables that the Drizzle migrations of `building` and `audit` create.
 */

const B1 = '018f0000-0000-7000-8000-000000000001'
const B2 = '018f0000-0000-7000-8000-000000000002'
const ID = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, '0')}`
const NIL = '00000000-0000-0000-0000-000000000000'
const ROLLBACK = Symbol('rollback')

let db: TestDb
let su: Sql

beforeAll(async () => {
  db = await cloneTemplate('empty')
  su = db.admin(1)
  await su.unsafe(`
    INSERT INTO building.building (id, code, name, company, address)
    VALUES ('${B1}', 'SUNRISE-A', '{"vi":"Chung cư Sunrise A","en":"Sunrise A Apartments"}', '{"name":{"vi":"Công ty"}}', '12 Nguyễn Huệ')`)
})
afterAll(async () => {
  await su.end()
  await db.drop()
})

/** 'ok', or the SQLSTATE of the statement; a failing `setup` is a broken test, not a result. */
async function run(setup: string[], statement: string): Promise<string> {
  try {
    await su.begin(async (tx) => {
      for (const prepare of setup) await tx.unsafe(prepare)
      await tx.unsafe('SAVEPOINT under_test')
      try {
        await tx.unsafe(statement)
      } catch (error) {
        throw Object.assign(new Error('statement'), {
          sqlstate: (error as { code?: string }).code ?? String(error),
        })
      }
      throw ROLLBACK
    })
  } catch (error) {
    if (error === ROLLBACK) return 'ok'
    const sqlstate = (error as { sqlstate?: string }).sqlstate
    if (sqlstate) return sqlstate
    throw error
  }
  return 'ok'
}

/** `column=value` of a building insert, as the column list and as the value list. */
const extraPart = (extra: string, index: number) => (extra ? `, ${extra.split('=')[index]}` : '')
/** `columns|values` of the stamps of a file insert. */
const stampPart = (stamps: string, index: number) => (stamps ? `, ${stamps.split('|')[index]}` : '')
const building = (code: string, over: Record<string, string> = {}) => {
  const v = {
    name: `'{"vi":"Tòa nhà"}'`,
    company: `'{"name":{"vi":"Công ty"}}'`,
    extra: '',
    ...over,
  }
  return `INSERT INTO building.building (id, code, name, company, address${extraPart(v.extra, 0)})
          VALUES ('${ID(900)}', '${code}', ${v.name}, ${v.company}, 'địa chỉ'${extraPart(v.extra, 1)})`
}
const gateway = (n: number, over: Record<string, string> = {}) => {
  const v = {
    provider: 'payos',
    driver: 'payos',
    blob: 'v1:k1:aa:bb',
    status: 'active',
    building: B1,
    extra: '',
    ...over,
  }
  return `INSERT INTO building.gateway_config (id, building_id, provider, driver, secrets_enc, receiving_account, status${v.extra ? ', last_check_at, last_check_ok' : ''})
          VALUES ('${ID(n)}', '${v.building}', '${v.provider}', '${v.driver}', '${v.blob}', '{"bankBin":"970436"}', '${v.status}'${v.extra})`
}
const terms = (n: number, kind = 'terms', version = 1, text = `'{"vi":"điều khoản"}'`) =>
  `INSERT INTO building.terms_version (id, building_id, kind, version, text, published_by) VALUES ('${ID(n)}', '${B1}', '${kind}', ${version}, ${text}, '${ID(1)}')`
const acceptance = (version: number, account = ID(2000)) =>
  `INSERT INTO building.terms_acceptance (building_id, account_id, version_id, ip, app_version) VALUES ('${B1}', '${account}', '${ID(version)}', '203.0.113.7', '1.4.0')`
const file = (n: number, over: Record<string, string> = {}) => {
  const v = {
    module: 'tickets',
    purpose: 'ticket_media',
    key: `test/${B1}/tickets/2026/10/${ID(n)}.jpg`,
    size: '1000',
    status: 'pending',
    kind: 'resident',
    account: ID(5),
    stamps: '',
    createdAt: 'now()',
    ownerRef: 'NULL',
    ...over,
  }
  return `INSERT INTO building.file_object (id, building_id, module, purpose, object_key, mime, size, status, account_kind, account_id, owner_ref, created_at${stampPart(v.stamps, 0)})
          VALUES ('${ID(n)}', '${B1}', '${v.module}', '${v.purpose}', '${v.key}', 'image/jpeg', ${v.size}, '${v.status}', '${v.kind}', '${v.account}', ${v.ownerRef}, ${v.createdAt}${stampPart(v.stamps, 1)})`
}
const audit = (n: number, over: Record<string, string> = {}) => {
  const v = {
    kind: 'staff',
    actor: `'${ID(1)}'`,
    role: `'manager'`,
    action: 'finance.payment.void',
    changes: `'[]'`,
    details: `'{}'`,
    at: 'now()',
    ...over,
  }
  return `INSERT INTO audit.audit_log (id, building_id, actor_kind, actor_id, actor_role, action, object_type, object_id, changes, details, at)
          VALUES ('${ID(n)}', '${B1}', '${v.kind}', ${v.actor}, ${v.role}, '${v.action}', 'payment', '${ID(7)}', ${v.changes}, ${v.details}, ${v.at})`
}
const job = (over: Record<string, string> = {}) => {
  const v = {
    name: 'invariant_check',
    status: 'succeeded',
    start: `now() - interval '1 minute'`,
    end: 'now()',
    details: `'{"violations":0}'`,
    ...over,
  }
  return `INSERT INTO building.job_run (id, name, started_at, finished_at, status, details) VALUES ('${ID(70)}', '${v.name}', ${v.start}, ${v.end}, '${v.status}', ${v.details})`
}

type Row = [id: string, setup: string[], statement: string, expected: string]

const ROWS: Row[] = [
  // building
  ['OPM-01', [], building('SUNRISE-B'), 'ok'],
  ['OPM-02', [], building('SUNRISE-A'), '23505'],
  ['OPM-03', [], building('sunrise-b'), '23514'],
  ['OPM-04', [], building('SUNRISE-B', { name: `'{"en":"Only English"}'` }), '23514'],
  ['OPM-05', [], building('SUNRISE-B', { company: `'[]'` }), '23514'],
  ['OPM-06', [], building('SUNRISE-B', { extra: `working_hours='{"en":"Mon-Fri"}'` }), '23514'],
  ['OPM-07', [], building('DEMO-A', { extra: `working_hours='{"vi":"Thứ 2 – Thứ 6"}'` }), 'ok'],
  ['OPM-08', [], building('SUNRISE-B', { extra: `time_zone='  '` }), '23514'],
  [
    'OPM-09',
    [],
    `UPDATE building.building SET logo_file = '${ID(404)}' WHERE id = '${B1}'`,
    '23503',
  ],
  // building_setting
  [
    'OPM-10',
    [],
    `INSERT INTO building.building_setting (building_id, data) VALUES ('${B1}', '{"defaultDueDays": 12}')`,
    'ok',
  ],
  [
    'OPM-11',
    [`INSERT INTO building.building_setting (building_id) VALUES ('${B1}')`],
    `INSERT INTO building.building_setting (building_id) VALUES ('${B1}')`,
    '23505',
  ],
  [
    'OPM-12',
    [],
    `INSERT INTO building.building_setting (building_id, data) VALUES ('${B1}', '[]')`,
    '23514',
  ],
  // gateway_config
  ['OPM-13', [], gateway(13), 'ok'],
  ['OPM-14', [gateway(13)], gateway(14), '23505'],
  ['OPM-15', [gateway(13)], gateway(15, { status: 'disabled' }), 'ok'],
  ['OPM-16', [gateway(13)], gateway(16, { provider: 'vietqr', driver: 'vietqr' }), 'ok'],
  ['OPM-17', [], gateway(17, { driver: 'stripe' }), '23514'],
  ['OPM-18', [], gateway(18, { blob: '{"apiKey":"x"}' }), '23514'],
  ['OPM-19', [], gateway(19, { extra: `, now(), NULL` }), '23514'],
  [
    'OPM-20',
    [building('SUNRISE-B').replace(ID(900), B2)],
    gateway(20, { driver: 'fake', building: B2, extra: `, now(), true` }),
    'ok',
  ],
  // terms
  ['OPM-21', [], terms(21), 'ok'],
  ['OPM-22', [terms(21)], terms(22), '23505'],
  ['OPM-23', [terms(21)], terms(23, 'privacy'), 'ok'],
  ['OPM-24', [], terms(24, 'terms', 1, `'{"en":"only English"}'`), '23514'],
  ['OPM-25', [], terms(25, 'cookies'), '23514'],
  [
    'OPM-26',
    [terms(21)],
    `UPDATE building.terms_version SET kind = 'privacy' WHERE id = '${ID(21)}'`,
    '23000',
  ],
  ['OPM-27', [terms(21)], acceptance(21), 'ok'],
  ['OPM-28', [terms(21), acceptance(21)], acceptance(21), '23505'],
  ['OPM-29', [], acceptance(404), '23503'],
  // audit
  [
    'OPM-30',
    [],
    audit(30, { changes: `'[{"field":"status","before":"posted","after":"void"}]'` }),
    'ok',
  ],
  [
    'OPM-31',
    [],
    audit(31, {
      kind: 'system',
      actor: 'NULL',
      role: 'NULL',
      action: 'finance.payment.post',
      details: `'{"source":"webhook"}'`,
    }),
    'ok',
  ],
  ['OPM-32', [], audit(32, { kind: 'system', role: 'NULL' }), '23514'],
  ['OPM-33', [], audit(33, { role: 'NULL' }), '23514'],
  ['OPM-34', [], audit(34, { kind: 'resident' }), '23514'],
  ['OPM-35', [], audit(35, { action: 'VoidPayment' }), '23514'],
  ['OPM-36', [], audit(36, { action: 'pii' }), '23514'],
  ['OPM-37', [], audit(37, { changes: `'{}'` }), '23514'],
  [
    'OPM-38',
    [],
    `INSERT INTO audit.audit_log (id, building_id, actor_kind, action, object_type, object_id, retention_class) VALUES ('${ID(38)}', '${B1}', 'system', 'a.b.c', 'x', '${ID(7)}', 'finance')`,
    '428C9',
  ],
  ['OPM-39', [audit(39)], `UPDATE audit.audit_log SET reason = 'edited'`, '23000'],
  ['OPM-40', [audit(40)], 'DELETE FROM audit.audit_log', '23000'],
  ['OPM-41', [audit(41)], 'TRUNCATE audit.audit_log', '23000'],
  [
    'OPM-42',
    [],
    audit(42, {
      action: 'pii.read',
      details: `'{"view":"export","kind":"residents","recordCount":300}'`,
    }),
    'ok',
  ],
  ['OPM-43', [], `SELECT audit.purge(now(), 'all')`, '22023'],
  // file_object
  ['OPM-50', [], file(50), 'ok'],
  ['OPM-51', [file(50)], file(51, { key: `test/${B1}/tickets/2026/10/${ID(50)}.jpg` }), '23505'],
  ['OPM-52', [], file(52, { module: 'platform' }), '23514'],
  ['OPM-53', [], file(53, { purpose: 'selfie' }), '23514'],
  ['OPM-54', [], file(54, { key: 'imports/2026/photo.jpg' }), '23514'],
  ['OPM-55', [], file(55, { key: `test/${B1}/tickets/2026/13/${ID(55)}.jpg` }), '23514'],
  ['OPM-56', [], file(56, { size: '-1' }), '23514'],
  ['OPM-57', [], file(57, { status: 'verified' }), '23514'],
  [
    'OPM-58',
    [file(58)],
    `UPDATE building.file_object SET status = 'verified', verified_at = now() WHERE id = '${ID(58)}'`,
    'ok',
  ],
  [
    'OPM-59',
    [
      file(59),
      `UPDATE building.file_object SET status = 'verified', verified_at = now() WHERE id = '${ID(59)}'`,
    ],
    `UPDATE building.file_object SET status = 'attached', attached_at = now(), owner_ref = 'ticket:1' WHERE id = '${ID(59)}'`,
    'ok',
  ],
  [
    'OPM-60',
    [file(60, { status: 'attached', stamps: 'verified_at, attached_at|now(), now()' })],
    `UPDATE building.file_object SET status = 'deleted', verified_at = NULL, attached_at = NULL WHERE id = '${ID(60)}'`,
    '23514',
  ],
  ['OPM-61', [], file(61, { kind: 'robot' }), '23514'],
  ['OPM-62', [], file(62, { status: 'deleted', stamps: 'deleted_at|now()' }), 'ok'],
  [
    'OPM-63',
    [],
    file(63, {
      module: 'building',
      purpose: 'logo',
      key: `test/${B1}/building/2026/10/${ID(63)}.jpg`,
      createdAt: `now() - interval '30 hours'`,
    }),
    'ok',
  ],
  [
    'OPM-64',
    [file(64)],
    `UPDATE building.building SET logo_file = '${ID(64)}' WHERE id = '${B1}'`,
    'ok',
  ],
  [
    'OPM-65',
    [],
    file(65, {
      purpose: 'thumbnail',
      kind: 'system',
      account: NIL,
      status: 'attached',
      ownerRef: `'thumb:${ID(64)}'`,
      stamps: 'verified_at, attached_at|now(), now()',
    }),
    'ok',
  ],
  ['OPM-66', [], file(66, { purpose: 'cccd' }), '23514'],
  // job_run
  ['OPM-70', [], job(), 'ok'],
  ['OPM-71', [], job({ status: 'running' }), '23514'],
  ['OPM-72', [], job({ start: 'now()', end: `now() - interval '1 minute'` }), '23514'],
  ['OPM-73', [], job({ name: 'Invariant Check' }), '23514'],
  ['OPM-74', [], job({ details: `'[]'` }), '23514'],
  // outbox and inbox of building
  [
    'OPM-80',
    [],
    `INSERT INTO building.outbox_messages (id, type, aggregate_id, payload, headers, occurred_at) VALUES ('${ID(80)}', 'finance.payment_posted.v1', 'x', '{"buildingId":"${B1}"}', '{}', now())`,
    'ok',
  ],
  [
    'OPM-81',
    [],
    `INSERT INTO building.inbox (message_id, handler) VALUES ('${ID(81)}', 'h1')`,
    'ok',
  ],
  [
    'OPM-82',
    [`INSERT INTO building.inbox (message_id, handler) VALUES ('${ID(81)}', 'h1')`],
    `INSERT INTO building.inbox (message_id, handler) VALUES ('${ID(81)}', 'h1')`,
    '23505',
  ],
  [
    'OPM-83',
    [`INSERT INTO building.inbox (message_id, handler) VALUES ('${ID(81)}', 'h1')`],
    `INSERT INTO building.inbox (message_id, handler) VALUES ('${ID(81)}', 'h2')`,
    'ok',
  ],
  // platform
  ['OPM-90', [], `INSERT INTO platform.maintenance (id, active) VALUES (true, false)`, 'ok'],
  [
    'OPM-91',
    [`INSERT INTO platform.maintenance (id, active) VALUES (true, false)`],
    `INSERT INTO platform.maintenance (id, active) VALUES (true, true)`,
    '23505',
  ],
  ['OPM-92', [], `INSERT INTO platform.maintenance (id, active) VALUES (false, false)`, '23514'],
  [
    'OPM-93',
    [],
    `INSERT INTO platform.idempotency_key (account_kind, account_id, key, request_hash) VALUES ('staff', '${ID(1)}', 'key-12345678', '${'a'.repeat(64)}')`,
    'ok',
  ],
  [
    'OPM-94',
    [],
    `INSERT INTO platform.idempotency_key (account_kind, account_id, key, request_hash) VALUES ('staff', '${ID(1)}', 'short', '${'a'.repeat(64)}')`,
    '23514',
  ],
  [
    'OPM-95',
    [],
    `INSERT INTO platform.idempotency_key (account_kind, account_id, key, request_hash) VALUES ('staff', '${ID(1)}', 'key-12345678', '${'A'.repeat(64)}')`,
    '23514',
  ],
  [
    'OPM-96',
    [],
    `INSERT INTO platform.idempotency_key (account_kind, account_id, key, request_hash, status) VALUES ('staff', '${ID(1)}', 'key-12345678', '${'a'.repeat(64)}', 'completed')`,
    '23514',
  ],
  [
    'OPM-97',
    [],
    `INSERT INTO platform.idempotency_key (account_kind, account_id, key, request_hash, status, response_status, response_body) VALUES ('staff', '${ID(1)}', 'key-12345678', '${'a'.repeat(64)}', 'completed', 201, '{"id":"x"}')`,
    'ok',
  ],
  [
    'OPM-98',
    [
      `INSERT INTO platform.idempotency_key (account_kind, account_id, key, request_hash) VALUES ('staff', '${ID(1)}', 'key-12345678', '${'a'.repeat(64)}')`,
    ],
    `INSERT INTO platform.idempotency_key (account_kind, account_id, key, request_hash) VALUES ('staff', '${ID(1)}', 'key-12345678', '${'b'.repeat(64)}')`,
    '23505',
  ],
  [
    'OPM-99',
    [],
    `INSERT INTO platform.rate_bucket (key, tokens) VALUES ('webhook:ip:203.0.113.7', 59)`,
    'ok',
  ],
]

describe('constraint tests (DOC-17 §13.2)', () => {
  for (const [id, setup, statement, expected] of ROWS)
    test(`${id} ${statement.replace(/\s+/g, ' ').slice(0, 80)} → ${expected}`, async () => {
      expect(await run(setup, statement)).toBe(expected)
    })
})

describe('the purge flag (DOC-17 §2)', () => {
  test('OPM-44 a DELETE in a later transaction, after a purge, is refused: the flag lives and dies with the transaction of the purge', async () => {
    await su.unsafe(audit(44, { at: `now() - interval '9 years'` }))
    await su.unsafe(`SELECT audit.purge(now(), 'standard')`)
    await su.unsafe(audit(45))
    await expect((async () => su.unsafe('DELETE FROM audit.audit_log'))()).rejects.toMatchObject({
      code: '23000',
    })
    expect(
      Number(
        (
          await su.unsafe(`SELECT count(*)::int AS n FROM audit.audit_log WHERE id = '${ID(45)}'`)
        )[0]?.n,
      ),
    ).toBe(1)
    // the row is committed: remove it the way the purge does, so the tests after this one start from an empty log
    await su.unsafe(`SET audit.purging = 'on'; DELETE FROM audit.audit_log; RESET audit.purging`)
  })
})

describe('statement tests (DOC-17 §13.3)', () => {
  test('OPM-S01 the quota counts every row that is not deleted and is served by ix_file_object_building_live', async () => {
    const rows = await su
      .begin(async (tx) => {
        await tx.unsafe(
          file(1, {
            size: '3400000',
            status: 'attached',
            stamps: 'verified_at, attached_at|now(), now()',
          }),
        )
        await tx.unsafe(file(2, { size: '200000', purpose: 'ticket_media' }))
        await tx.unsafe(file(3, { size: '9000000', status: 'deleted', stamps: 'deleted_at|now()' }))
        await tx.unsafe('SET LOCAL enable_seqscan = off')
        const sum = await tx.unsafe(
          `SELECT coalesce(sum(size), 0)::bigint AS used FROM building.file_object WHERE building_id = '${B1}' AND status <> 'deleted'`,
        )
        const plan = await tx.unsafe(
          `EXPLAIN SELECT coalesce(sum(size), 0) FROM building.file_object WHERE building_id = '${B1}' AND status <> 'deleted'`,
        )
        throw Object.assign(new Error('done'), { sum, plan })
      })
      .catch((e) => e)
    expect(Number(rows.sum[0].used)).toBe(3_600_000)
    expect(JSON.stringify(rows.plan)).toContain('ix_file_object_building_live')
  })

  test('OPM-S02 the orphan query finds the 30-hour row through ix_file_object_building_unattached', async () => {
    const result = await su
      .begin(async (tx) => {
        await tx.unsafe(
          file(1, {
            purpose: 'logo',
            module: 'building',
            key: `test/${B1}/building/2026/10/${ID(1)}.jpg`,
            createdAt: `now() - interval '30 hours'`,
          }),
        )
        await tx.unsafe(file(2))
        // The design measured the plan on 20,030 rows: a table of a few rows would pick any index.
        await tx.unsafe(`INSERT INTO building.file_object (id, building_id, module, purpose, object_key, mime, size, status, account_kind, account_id, verified_at, attached_at)
        SELECT id, '${B1}', 'tickets', 'ticket_media', 'test/${B1}/tickets/2026/10/' || id || '.jpg', 'image/jpeg', 1000, 'attached', 'resident', '${ID(5)}', now(), now()
          FROM (SELECT uuidv7() AS id FROM generate_series(1, 20000)) g`)
        await tx.unsafe('ANALYZE building.file_object')
        await tx.unsafe('SET LOCAL enable_seqscan = off')
        const query = `FROM building.file_object WHERE building_id = '${B1}' AND status IN ('pending', 'verified') AND created_at < now() - interval '24 hours'`
        const rows = await tx.unsafe(`SELECT id ${query}`)
        const plan = await tx.unsafe(`EXPLAIN SELECT id ${query}`)
        throw Object.assign(new Error('done'), { rows, plan })
      })
      .catch((e) => e)
    expect(result.rows.map((r: { id: string }) => r.id)).toEqual([ID(1)])
    expect(JSON.stringify(result.plan)).toContain('ix_file_object_building_unattached')
  })

  test('OPM-S03 the re-encrypt compare-and-set changes one row, then none', async () => {
    const result = await su
      .begin(async (tx) => {
        await tx.unsafe(gateway(1, { blob: 'v1:k1:old:blob' }))
        const cas = `UPDATE building.gateway_config SET secrets_enc = 'v1:k2:new:blob', version = version + 1, updated_at = now() WHERE id = '${ID(1)}' AND secrets_enc = 'v1:k1:old:blob' RETURNING id`
        const first = await tx.unsafe(cas)
        const second = await tx.unsafe(cas)
        const inUse = await tx.unsafe(
          `SELECT split_part(secrets_enc, ':', 2) AS key_id, count(*)::int AS n FROM building.gateway_config GROUP BY 1`,
        )
        throw Object.assign(new Error('done'), {
          first: first.length,
          second: second.length,
          inUse,
        })
      })
      .catch((e) => e)
    expect([result.first, result.second]).toEqual([1, 0])
    expect(result.inUse).toEqual([expect.objectContaining({ key_id: 'k2', n: 1 })])
  })

  test('OPM-S04 the last success per job', async () => {
    const rows = await su
      .begin(async (tx) => {
        await tx.unsafe(
          job({ end: `now() - interval '2 hours'`, start: `now() - interval '3 hours'` }),
        )
        await tx.unsafe(job().replace(ID(70), ID(71)))
        await tx.unsafe(job({ name: 'audit_purge', status: 'failed' }).replace(ID(70), ID(72)))
        const result = await tx.unsafe(
          `SELECT name, max(finished_at) AS last_success FROM building.job_run WHERE status = 'succeeded' GROUP BY name`,
        )
        throw Object.assign(new Error('done'), { result })
      })
      .catch((e) => e)
    expect(rows.result.map((r: { name: string }) => r.name)).toEqual(['invariant_check'])
  })

  test('OPM-S05 the latest terms version per kind and whether it was accepted', async () => {
    const rows = await su
      .begin(async (tx) => {
        await tx.unsafe(terms(1, 'terms', 1))
        await tx.unsafe(terms(2, 'terms', 2))
        await tx.unsafe(terms(3, 'privacy', 1))
        await tx.unsafe(acceptance(2))
        const result = await tx.unsafe(`
        SELECT v.kind, v.version,
               EXISTS (SELECT 1 FROM building.terms_acceptance a WHERE a.account_id = '${ID(2000)}' AND a.version_id = v.id) AS accepted
          FROM (SELECT DISTINCT ON (kind) id, kind, version FROM building.terms_version WHERE building_id = '${B1}' ORDER BY kind, version DESC) v
         ORDER BY v.kind`)
        throw Object.assign(new Error('done'), { result })
      })
      .catch((e) => e)
    expect(
      rows.result.map((r: { kind: string; version: number; accepted: boolean }) => [
        r.kind,
        r.version,
        r.accepted,
      ]),
    ).toEqual([
      ['privacy', 1, false],
      ['terms', 2, true],
    ])
  })

  const purgeCase = async (rows: Array<[string, string]>, call: string) => {
    const result = await su
      .begin(async (tx) => {
        let n = 100
        for (const [action, age] of rows)
          await tx.unsafe(audit(n++, { action, at: `now() - interval '${age}'` }))
        const purged = await tx.unsafe(call)
        const left = await tx.unsafe('SELECT count(*)::int AS n FROM audit.audit_log')
        throw Object.assign(new Error('done'), {
          purged: Number(purged[0]?.purge),
          left: left[0]?.n,
        })
      })
      .catch((e) => e)
    return { purged: result.purged as number, left: result.left as number }
  }

  test('OPM-S09 audit.purge(now() + 10 years, finance) with rows of 6 and 4 years removes only the 6-year row', async () => {
    expect(
      await purgeCase(
        [
          ['finance.payment.void', '6 years'],
          ['finance.payment.void', '4 years'],
        ],
        `SELECT audit.purge(now() + interval '10 years', 'finance') AS purge`,
      ),
    ).toEqual({ purged: 1, left: 1 })
  })

  test('OPM-S10 audit.purge(now(), standard) with rows of 3 and 1 years removes the 3-year row', async () => {
    expect(
      await purgeCase(
        [
          ['residency.unit.update', '3 years'],
          ['residency.unit.update', '1 year'],
        ],
        `SELECT audit.purge(now(), 'standard') AS purge`,
      ),
    ).toEqual({ purged: 1, left: 1 })
  })

  test('OPM-S11 a cut-off in 1990 removes nothing', async () => {
    expect(
      await purgeCase(
        [['residency.unit.update', '3 years']],
        `SELECT audit.purge('1990-01-01', 'standard') AS purge`,
      ),
    ).toEqual({ purged: 0, left: 1 })
  })

  test('OPM-S12 the retention class of finance.payment.void, finance.payment.post and pii.read', async () => {
    const result = await su
      .begin(async (tx) => {
        for (const [n, action] of [
          [1, 'finance.payment.void'],
          [2, 'finance.payment.post'],
          [3, 'pii.read'],
        ] as const)
          await tx.unsafe(audit(n, { action }))
        const rows = await tx.unsafe(
          'SELECT action, retention_class FROM audit.audit_log ORDER BY id',
        )
        throw Object.assign(new Error('done'), { rows })
      })
      .catch((e) => e)
    expect(result.rows.map((r: { retention_class: string }) => r.retention_class)).toEqual([
      'finance',
      'finance',
      'standard',
    ])
  })
})
