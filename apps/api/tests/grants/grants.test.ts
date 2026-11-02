import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { adminUrl, cloneTemplate, type TestDb, withDatabase } from '@rms/test-support'
import postgres, { type Sql } from 'postgres'
import { SEED, STAND_INS } from './fixtures'

/**
 * The permission tests of DOC-19 §9: the matrix of roles × schemas, as data. Statement tests run one statement as a role
 * (`SET LOCAL ROLE`, rolled back) and compare the SQLSTATE; login tests open a real connection; catalog checks must return
 * no rows. They run on a clone of the migrated template (`0000-bootstrap.sql`, the migrations, `0900-grants.sql`) in which
 * `fixtures.ts` created stand-ins for the tables the grants step names, and the grants step ran again over them.
 */

const GRANTS_SQL = readFileSync(
  new URL('../../../../ops/postgres/0900-grants.sql', import.meta.url),
  'utf8',
)
const ROLLBACK = Symbol('rollback')

let db: TestDb
let su: Sql
let migrator: Sql

/** 'ok', or the SQLSTATE the statement failed with. */
async function as(role: string, statement: string): Promise<string> {
  try {
    await su.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${role}`)
      await tx.unsafe(statement)
      throw ROLLBACK
    })
  } catch (error) {
    if (error === ROLLBACK) return 'ok'
    return (error as { code?: string }).code ?? String(error)
  }
  return 'ok'
}

const sqlstate = (error: unknown) => (error as { code?: string }).code

beforeAll(async () => {
  db = await cloneTemplate('empty')
  su = postgres(withDatabase(adminUrl(), db.name), { max: 2, prepare: false, onnotice: () => {} })
  migrator = db.admin(1)
  await migrator.unsafe(STAND_INS)
  await migrator.unsafe(SEED)
  await migrator.unsafe(GRANTS_SQL)
  await su`DROP ROLE IF EXISTS rms_stranger`
  await su`CREATE ROLE rms_stranger LOGIN PASSWORD 'stranger-password' NOSUPERUSER NOCREATEDB NOCREATEROLE`
})
afterAll(async () => {
  await su.end()
  await migrator.end()
  await db.drop()
  const cleanup = postgres(adminUrl(), { max: 1, prepare: false })
  await cleanup`DROP ROLE IF EXISTS rms_stranger`
  await cleanup.end()
})

type Row = [id: string, role: string, statement: string, expected: string]

const ROWS: Row[] = [
  // rms_app cannot change the schema, the roles or the server
  ['GRT-01', 'rms_app', 'CREATE TABLE finance.evil (id int)', '42501'],
  ['GRT-02', 'rms_app', 'CREATE SCHEMA evil', '42501'],
  ['GRT-03', 'rms_app', 'DROP TABLE building.building', '42501'],
  ['GRT-04', 'rms_app', 'ALTER TABLE finance.inbox ADD COLUMN evil int', '42501'],
  ['GRT-05', 'rms_app', 'TRUNCATE finance.inbox', '42501'],
  ['GRT-06', 'rms_app', 'CREATE EXTENSION hstore', '42501'],
  ['GRT-07', 'rms_app', 'CREATE ROLE evil', '42501'],
  [
    'GRT-08',
    'rms_app',
    'ALTER TABLE building.terms_version DISABLE TRIGGER trg_terms_version_freeze',
    '42501',
  ],
  ['GRT-09', 'rms_app', 'DROP FUNCTION audit.audit_log_append_only() CASCADE', '42501'],
  // rms_app does its job
  ['GRT-10', 'rms_app', 'UPDATE identity.staff_account SET status = status WHERE false', 'ok'],
  [
    'GRT-11',
    'rms_app',
    `INSERT INTO residency.resident_profile (building_id, account_id, full_name) VALUES (gen_random_uuid(), gen_random_uuid(), 'Đặng Thị Vân')`,
    'ok',
  ],
  ['GRT-12', 'rms_app', 'DELETE FROM finance.inbox WHERE false', 'ok'],
  ['GRT-13', 'rms_app', 'SELECT * FROM building.file_object', 'ok'],
  [
    'GRT-14',
    'rms_app',
    `INSERT INTO audit.audit_log (id, building_id, actor_kind, action, object_type, object_id)
     VALUES (gen_random_uuid(), gen_random_uuid(), 'system', 'x.y.z', 'x', gen_random_uuid())`,
    'ok',
  ],
  ['GRT-15', 'rms_app', 'SELECT * FROM audit.audit_log', 'ok'],
  // the audit log is append-only; the maintenance flag is read-only for rms_app
  ['GRT-16', 'rms_app', `UPDATE audit.audit_log SET action = 'x.y.z'`, '42501'],
  ['GRT-17', 'rms_app', 'DELETE FROM audit.audit_log', '42501'],
  ['GRT-18', 'rms_app', 'TRUNCATE audit.audit_log', '42501'],
  ['GRT-19', 'rms_app', `SELECT audit.purge(now() - interval '1000 years', 'standard')`, 'ok'],
  ['GRT-20', 'rms_app', 'SELECT * FROM platform.maintenance', 'ok'],
  ['GRT-21', 'rms_app', 'UPDATE platform.maintenance SET active = true', '42501'],
  ['GRT-22', 'rms_app', 'DELETE FROM platform.maintenance', '42501'],
  [
    'GRT-23',
    'rms_app',
    `INSERT INTO platform.rate_bucket (key, tokens) VALUES ('webhook:ip:x', 1)`,
    'ok',
  ],
  [
    'GRT-24',
    'rms_app',
    `SELECT platform.is_bilingual('{"vi":"a"}'::jsonb), platform.immutable_unaccent('Nguyễn')`,
    'ok',
  ],
  ['GRT-25', 'rms_app', 'SELECT * FROM pg_authid', '42501'],
  ['GRT-26', 'rms_app', `COPY (SELECT 1) TO PROGRAM 'cat'`, '42501'],
  ['GRT-27', 'rms_app', `SELECT pg_read_file('/etc/passwd')`, '42501'],
  ['GRT-28', 'rms_app', 'ALTER ROLE rms_app SUPERUSER', '42501'],
  // rms_readonly sees what a support query needs and no secret
  ['GRT-29', 'rms_readonly', 'SELECT email, role, status FROM identity.staff_account', 'ok'],
  ['GRT-30', 'rms_readonly', 'SELECT password_hash FROM identity.staff_account', '42501'],
  ['GRT-31', 'rms_readonly', 'SELECT * FROM identity.staff_account', '42501'],
  ['GRT-32', 'rms_readonly', 'SELECT * FROM identity.refresh_token', '42501'],
  ['GRT-33', 'rms_readonly', 'SELECT * FROM identity.password_token', '42501'],
  ['GRT-34', 'rms_readonly', 'SELECT * FROM identity.otp_challenge', '42501'],
  ['GRT-35', 'rms_readonly', 'SELECT * FROM identity.rate_bucket', '42501'],
  ['GRT-36', 'rms_readonly', 'SELECT payload FROM finance.outbox_messages', '42501'],
  ['GRT-37', 'rms_readonly', 'SELECT secrets_enc FROM building.gateway_config', '42501'],
  [
    'GRT-38',
    'rms_readonly',
    'SELECT provider, driver, receiving_account, status FROM building.gateway_config',
    'ok',
  ],
  ['GRT-39', 'rms_readonly', 'SELECT date_of_birth FROM residency.resident_profile', '42501'],
  ['GRT-40', 'rms_readonly', 'SELECT cccd_enc FROM residency.resident_profile', '42501'],
  ['GRT-41', 'rms_readonly', 'SELECT full_name, cccd_last4 FROM residency.resident_profile', 'ok'],
  ['GRT-42', 'rms_readonly', 'SELECT * FROM platform.idempotency_key', '42501'],
  ['GRT-43', 'rms_readonly', 'SELECT * FROM audit.audit_log', 'ok'],
  // the usage record (DR-279): written and rolled up by rms_app, read by rms_readonly, which has no write privilege
  ['GRT-98', 'rms_app', 'DELETE FROM analytics.usage_event WHERE false', 'ok'],
  ['GRT-99', 'rms_readonly', 'SELECT * FROM analytics.usage_daily', 'ok'],
  ['GRT-100', 'rms_readonly', 'DELETE FROM analytics.usage_event WHERE false', '42501'],
  [
    'GRT-44',
    'rms_readonly',
    `INSERT INTO building.building_setting (building_id) VALUES (gen_random_uuid())`,
    '42501',
  ],
  ['GRT-45', 'rms_readonly', `UPDATE building.building SET address = 'x'`, '42501'],
  ['GRT-46', 'rms_readonly', 'DELETE FROM finance.inbox', '42501'],
  ['GRT-47', 'rms_readonly', 'TRUNCATE finance.inbox', '42501'],
  ['GRT-48', 'rms_readonly', `SELECT audit.purge(now(), 'standard')`, '42501'],
  ['GRT-49', 'rms_readonly', 'SELECT count(*) FROM pg_stat_activity', 'ok'],
  ['GRT-50', 'rms_readonly', 'CREATE TABLE public.x (id int)', '42501'],
  // rms_backup reads everything (the dump) and writes nothing
  ['GRT-51', 'rms_backup', 'SELECT * FROM identity.staff_account', 'ok'],
  [
    'GRT-52',
    'rms_backup',
    'SELECT password_hash, secrets_enc FROM identity.staff_account, building.gateway_config',
    'ok',
  ],
  [
    'GRT-53',
    'rms_backup',
    `INSERT INTO finance.inbox (message_id, handler) VALUES (gen_random_uuid(), 'x')`,
    '42501',
  ],
  ['GRT-54', 'rms_backup', 'CREATE TABLE public.x (id int)', '42501'],
  ['GRT-55', 'rms_backup', 'SELECT pg_switch_wal()', 'ok'],
  ['GRT-56', 'rms_backup', `SELECT pg_create_restore_point('grants-test')`, 'ok'],
  [
    'GRT-57',
    'rms_backup',
    `SELECT current_setting('archive_command'), current_setting('data_directory')`,
    'ok',
  ],
  ['GRT-58', 'rms_backup', `SELECT audit.purge(now(), 'standard')`, '42501'],
  // rms_migrator owns the objects
  [
    'GRT-59',
    'rms_migrator',
    'CREATE TABLE finance.t (id int); ALTER TABLE finance.t ADD COLUMN n int; DROP TABLE finance.t',
    'ok',
  ],
  ['GRT-60', 'rms_migrator', `UPDATE audit.audit_log SET action = 'x.y.z'`, '23000'],
  ['GRT-61', 'rms_migrator', 'DELETE FROM audit.audit_log', '23000'],
  ['GRT-62', 'rms_migrator', 'CREATE ROLE evil', '42501'],
  [
    'GRT-63',
    'rms_migrator',
    'UPDATE platform.maintenance SET active = true; UPDATE platform.maintenance SET active = false',
    'ok',
  ],
  ['GRT-64', 'rms_migrator', 'SELECT * FROM pg_authid', '42501'],
  // a role that was granted nothing
  ['GRT-65', 'rms_stranger', 'SELECT * FROM building.building', '42501'],
  ['GRT-66', 'rms_stranger', 'CREATE TABLE public.x (id int)', '42501'],
  ['GRT-67', 'rms_stranger', `SELECT platform.immutable_unaccent('x')`, '42501'],
]

describe('statement tests (DOC-19 §9.2)', () => {
  for (const [id, role, statement, expected] of ROWS)
    test(`${id} ${role}: ${statement.slice(0, 70)} → ${expected}`, async () => {
      expect(await as(role, statement)).toBe(expected)
    })
})

describe('the grants step fails closed and is idempotent (GRT-68…76)', () => {
  const aclHash = async () =>
    (
      (await su`SELECT md5(string_agg(n.nspname || '.' || c.relname || ':' || coalesce(c.relacl::text, ''), ',' ORDER BY n.nspname, c.relname)) AS h
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p', 'S') AND n.nspname = ANY (ARRAY['identity','building','residency','finance','tickets','access','vehicles','notices','notification','wiki','audit','reporting','realtime','analytics','platform'])`) as {
        h: string
      }[]
    )[0]?.h

  test('a table made by a migration is closed until the grants step runs, then open, and a second run changes nothing', async () => {
    await migrator.unsafe(`
      CREATE SCHEMA IF NOT EXISTS drizzle_tickets;
      CREATE TABLE drizzle_tickets.__migrations (id int);
      CREATE TABLE tickets.late_table (id int PRIMARY KEY, note text, token_hash text);
      CREATE SEQUENCE tickets.late_seq;`)
    expect(await as('rms_app', 'SELECT * FROM tickets.late_table')).toBe('42501') // GRT-68
    expect(await as('rms_app', `SELECT nextval('tickets.late_seq')`)).toBe('42501') // GRT-69
    expect(await as('rms_readonly', 'SELECT * FROM tickets.late_table')).toBe('42501') // GRT-70

    await migrator.unsafe(GRANTS_SQL)
    const first = await aclHash()
    await migrator.unsafe(GRANTS_SQL)
    expect(await aclHash()).toBe(first)

    expect(await as('rms_app', `INSERT INTO tickets.late_table (id, note) VALUES (1, 'x')`)).toBe(
      'ok',
    ) // GRT-71
    expect(await as('rms_app', `SELECT nextval('tickets.late_seq')`)).toBe('ok') // GRT-72
    expect(await as('rms_readonly', 'SELECT id, note FROM tickets.late_table')).toBe('ok') // GRT-73
    expect(await as('rms_readonly', 'SELECT token_hash FROM tickets.late_table')).toBe('42501') // GRT-74
    expect(await as('rms_app', 'SELECT * FROM drizzle_tickets.__migrations')).toBe('42501') // GRT-75
    expect(await as('rms_readonly', 'SELECT * FROM drizzle_tickets.__migrations')).toBe('42501') // GRT-76
  })
})

describe('login tests (DOC-19 §9.3)', () => {
  const connect = (user: string, password: string, database = db.name) => {
    const url = new URL(withDatabase(adminUrl(), database))
    url.username = user
    url.password = password
    return postgres(url.toString(), {
      max: 1,
      prepare: false,
      connect_timeout: 5,
      onnotice: () => {},
    })
  }
  const passwordOf = (role: string) =>
    process.env[`RMS_${role.replace('rms_', '').toUpperCase()}_PASSWORD`] as string

  test('GRT-77 rms_app signs in with SCRAM and reads platform.maintenance; GRT-78 a wrong password is refused', async () => {
    const app = connect('rms_app', passwordOf('rms_app'))
    expect((await app`SELECT count(*)::int AS n FROM platform.maintenance`)[0]?.n).toBe(1)
    await app.end()
    const wrong = connect('rms_app', 'not-the-password')
    const error = await wrong`SELECT 1`.then(
      () => undefined,
      (e: Error) => e,
    )
    expect(String(error?.message)).toContain('password authentication failed')
    await wrong.end({ timeout: 1 }).catch(() => {})
  })

  test('GRT-79 rms_app cannot SET ROLE rms_migrator; GRT-80 its settings are the planned ones; GRT-81 it has no attribute', async () => {
    const app = connect('rms_app', passwordOf('rms_app'))
    const refused = await app`SET ROLE rms_migrator`.then(() => 'ok', sqlstate)
    expect(refused).toBe('42501')
    const settings =
      await app`SELECT current_setting('search_path') AS search_path, current_setting('statement_timeout') AS statement_timeout,
      current_setting('lock_timeout') AS lock_timeout, current_setting('idle_in_transaction_session_timeout') AS idle`
    expect(settings[0]).toEqual({
      search_path: 'public',
      statement_timeout: '30s',
      lock_timeout: '10s',
      idle: '1min',
    })
    const attrs =
      await su`SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolconnlimit FROM pg_roles WHERE rolname = 'rms_app'`
    expect(attrs[0]).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
      rolconnlimit: 80,
    })
    await app.end()
  })

  test('GRT-82 rms_migrator cannot create a database; GRT-83 and GRT-84 rms_readonly is read-only with its own timeout', async () => {
    const owner = connect('rms_migrator', passwordOf('rms_migrator'))
    expect(await owner`CREATE DATABASE evil`.then(() => 'ok', sqlstate)).toBe('42501')
    await owner.end()
    const readonly = connect('rms_readonly', passwordOf('rms_readonly'))
    expect(
      await readonly`INSERT INTO platform.rate_bucket (key, tokens) VALUES ('x', 1)`.then(
        () => 'ok',
        sqlstate,
      ),
    ).toBe('25006')
    const settings =
      await readonly`SELECT current_setting('default_transaction_read_only') AS ro, current_setting('statement_timeout') AS timeout`
    expect(settings[0]).toEqual({ ro: 'on', timeout: '1min' })
    expect((await readonly`SELECT count(*)::int AS n FROM pg_stat_database`)[0]?.n).toBeGreaterThan(
      0,
    ) // GRT-88
    await readonly.end()
  })

  test('GRT-85 a role that was granted nothing cannot connect to the application database', async () => {
    const stranger = connect('rms_stranger', 'stranger-password', 'rms')
    const error = await stranger`SELECT 1`.then(
      () => undefined,
      (e: Error) => e,
    )
    expect(String(error?.message)).toContain('permission denied for database')
    await stranger.end({ timeout: 1 }).catch(() => {})
  })

  test.skip('GRT-86 and GRT-87 rms_backup over the local socket (peer authentication): run on the host in P1-20', () => {})
})

describe('catalog checks: each must return no rows (DOC-19 §9.4)', () => {
  const SCHEMA_LIST = `ARRAY['identity','building','residency','finance','tickets','access','vehicles','notices','notification','wiki','audit','reporting','realtime','analytics','platform']`
  const checks: [string, string][] = [
    [
      'GRT-89 rms_app holds TRUNCATE, REFERENCES or TRIGGER',
      `SELECT n.nspname, c.relname, p FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, unnest(ARRAY['TRUNCATE','REFERENCES','TRIGGER']) p WHERE c.relkind IN ('r','p') AND n.nspname = ANY (${SCHEMA_LIST}) AND has_table_privilege('rms_app', c.oid, p)`,
    ],
    [
      'GRT-90 a table lacks a privilege rms_app needs',
      `SELECT n.nspname, c.relname, p FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p WHERE c.relkind IN ('r','p') AND n.nspname = ANY (${SCHEMA_LIST}) AND NOT has_table_privilege('rms_app', c.oid, p) AND NOT (n.nspname || '.' || c.relname = 'audit.audit_log' AND p IN ('UPDATE','DELETE')) AND NOT (n.nspname || '.' || c.relname = 'platform.maintenance' AND p IN ('INSERT','UPDATE','DELETE'))`,
    ],
    [
      'GRT-91 rms_readonly holds a write privilege, REFERENCES or TRIGGER',
      `SELECT n.nspname, c.relname, p FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE c.relkind IN ('r','p') AND n.nspname = ANY (${SCHEMA_LIST}) AND has_table_privilege('rms_readonly', c.oid, p)`,
    ],
    [
      'GRT-92 rms_readonly reads a denied table or an outbox, even one column',
      `SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped WHERE c.relkind IN ('r','p') AND (n.nspname || '.' || c.relname = ANY (ARRAY['identity.otp_challenge','identity.password_token','identity.refresh_family','identity.refresh_token','identity.rate_bucket','platform.idempotency_key','platform.rate_bucket','notification.device_token']) OR c.relname = 'outbox_messages') AND has_column_privilege('rms_readonly', c.oid, a.attnum, 'SELECT')`,
    ],
    [
      'GRT-93 rms_readonly reads a *_hash, *_enc or date_of_birth column',
      `SELECT n.nspname, c.relname, a.attname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped WHERE c.relkind IN ('r','p') AND n.nspname = ANY (${SCHEMA_LIST}) AND (a.attname ~ '(_hash|_enc)$' OR a.attname = 'date_of_birth') AND has_column_privilege('rms_readonly', c.oid, a.attnum, 'SELECT')`,
    ],
    [
      'GRT-94 a table or schema is not owned by rms_migrator',
      `SELECT nspname FROM pg_namespace WHERE nspname = ANY (${SCHEMA_LIST}) AND pg_get_userbyid(nspowner) <> 'rms_migrator' UNION ALL SELECT n.nspname || '.' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ANY (${SCHEMA_LIST}) AND c.relkind IN ('r','p','S') AND pg_get_userbyid(c.relowner) <> 'rms_migrator'`,
    ],
    [
      'GRT-95 PUBLIC holds a privilege on a schema',
      `SELECT nspname FROM pg_namespace, aclexplode(coalesce(nspacl, '{}')) a WHERE nspname = ANY (${SCHEMA_LIST}) AND a.grantee = 0`,
    ],
    [
      'GRT-96 a role can CREATE in a schema or the database',
      `SELECT r, nspname FROM unnest(ARRAY['rms_app','rms_readonly','rms_backup','rms_stranger']) r, pg_namespace WHERE nspname = ANY (${SCHEMA_LIST}) AND has_schema_privilege(r, nspname, 'CREATE') UNION ALL SELECT r, 'database' FROM unnest(ARRAY['rms_app','rms_readonly','rms_backup','rms_stranger']) r WHERE has_database_privilege(r, current_database(), 'CREATE')`,
    ],
  ]
  for (const [title, query] of checks)
    test(title, async () => {
      expect([...(await su.unsafe(query))]).toEqual([])
    })

  test('GRT-97 the only SECURITY DEFINER function outside pg_catalog is audit.purge, executable by rms_app and rms_migrator only', async () => {
    const functions = await su`
      SELECT n.nspname || '.' || p.proname AS name, has_function_privilege('rms_app', p.oid, 'EXECUTE') AS app,
             has_function_privilege('rms_migrator', p.oid, 'EXECUTE') AS migrator, has_function_privilege('rms_readonly', p.oid, 'EXECUTE') AS readonly,
             has_function_privilege('rms_backup', p.oid, 'EXECUTE') AS backup
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')`
    expect([...functions]).toEqual([
      { name: 'audit.purge', app: true, migrator: true, readonly: false, backup: false },
    ])
  })
})

describe('the bootstrap (DOC-14 §16 checks 1, 9 and 13)', () => {
  test('check 1 uuidv7() makes a version 7 uuid', async () => {
    expect((await su`SELECT uuid_extract_version(uuidv7()) AS v`)[0]?.v).toBe(7)
  })

  test('check 9 the building day at 23:30, 00:30 and 06:59 local with the session in UTC', async () => {
    const rows = await su<{ d: string }[]>`
      SELECT to_char((t AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS d
        FROM unnest(ARRAY['2026-10-15 16:30:00+00','2026-10-15 17:30:00+00','2026-10-15 23:59:00+00']::timestamptz[]) t`
    expect(rows.map((r) => r.d)).toEqual(['2026-10-15', '2026-10-16', '2026-10-16'])
  })

  test('check 13 platform.is_bilingual', async () => {
    const values = [
      '{"vi":"a"}',
      '{"vi":"a","en":"b"}',
      '{"vi":""}',
      '{"en":"b"}',
      '{"vi":1}',
      '"vi"',
      '{"vi":"a","en":null}',
    ]
    const results = await Promise.all(
      values.map(
        async (v) => (await su.unsafe(`SELECT platform.is_bilingual('${v}'::jsonb) AS ok`))[0]?.ok,
      ),
    )
    expect(results).toEqual([true, true, false, false, false, false, false])
    expect((await su`SELECT platform.is_bilingual(NULL) AS ok`)[0]?.ok).toBe(false)
  })

  test('the unaccent wrapper and a trigram index find "dang thi" and "van an"', async () => {
    await su`INSERT INTO residency.resident_profile (building_id, account_id, full_name) VALUES (gen_random_uuid(), gen_random_uuid(), 'Đặng Thị Vân')`
    const found = await su<
      { full_name: string }[]
    >`SELECT full_name FROM residency.resident_profile WHERE platform.immutable_unaccent(lower(full_name)) LIKE ${'%dang thi%'} OR platform.immutable_unaccent(lower(full_name)) LIKE ${'%van an%'} ORDER BY full_name`
    expect(found.map((r) => r.full_name).sort()).toEqual(['Nguyễn Văn An', 'Đặng Thị Vân'].sort())
  })

  test('the bootstrap is idempotent: a second run leaves the same objects', async () => {
    const bootstrap = readFileSync(
      new URL('../../../../ops/postgres/0000-bootstrap.sql', import.meta.url),
      'utf8',
    )
    const count = async () =>
      (
        await su`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'platform'`
      )[0]?.n
    const before = await count()
    await migrator.unsafe(bootstrap)
    expect(await count()).toBe(before)
  })
})
