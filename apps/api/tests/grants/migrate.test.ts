import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database, migrateModule } from '@core/db'
import { adminUrl, cloneTemplate, migratorUrl, type TestDb, withDatabase } from '@rms/test-support'
import postgres from 'postgres'

/** `bun run db:migrate` (DOC-19 §3.1, DOC-14 §14): the bootstrap, the migrations of a module, then the grants. */

const FIXTURE = new URL('../fixtures/probe-migrations', import.meta.url).pathname
const ROOT = new URL('../../../..', import.meta.url).pathname

describe('per-module Drizzle migrations run by the migrator', () => {
  let db: TestDb
  let database: Database
  beforeAll(async () => {
    db = await cloneTemplate('empty')
    database = new Database({
      url: withDatabase(migratorUrl(), db.name),
      poolMax: 1,
      prepare: false,
    })
  })
  afterAll(async () => {
    await database.close()
    await db.drop()
  })

  const history = async () =>
    (await database.client.unsafe(`select count(*)::int as n from drizzle_probe.__migrations`))[0]
      ?.n as number

  test('the migrations apply in order, the history lives in drizzle_<module>, and a second run applies nothing', async () => {
    await migrateModule(database, 'probe', FIXTURE)
    expect(await history()).toBe(2)
    const columns = await database.client.unsafe(
      `select column_name from information_schema.columns where table_schema = 'finance' and table_name = 'probe_item' order by ordinal_position`,
    )
    expect(columns.map((c) => c.column_name)).toEqual(['id', 'note', 'flag'])
    await migrateModule(database, 'probe', FIXTURE)
    expect(await history()).toBe(2)
  })

  test('P1-06 after the grants step rms_app can use the new table but cannot run DDL, nor read the migration history', async () => {
    await database.client.unsafe(await Bun.file(`${ROOT}ops/postgres/0900-grants.sql`).text())
    const app = db.sql
    await app`INSERT INTO finance.probe_item (id, note) VALUES (gen_random_uuid(), 'x')`
    expect((await app`SELECT count(*)::int AS n FROM finance.probe_item`)[0]?.n).toBe(1)
    for (const statement of [
      'CREATE TABLE finance.evil (id int)',
      'ALTER TABLE finance.probe_item ADD COLUMN evil int',
      'DROP TABLE finance.probe_item',
      'CREATE SCHEMA evil',
    ]) {
      const code = await app.unsafe(statement).then(
        () => 'ok',
        (e: { code?: string }) => e.code,
      )
      expect({ statement, code }).toEqual({ statement, code: '42501' })
    }
    const history = await app`SELECT * FROM drizzle_probe.__migrations`.then(
      () => 'ok',
      (e: { code?: string }) => e.code,
    )
    expect(history).toBe('42501')
  })
})

describe('the db:migrate command on a database that holds nothing', () => {
  const name = `rms_t_migrate_${process.pid}`
  let su: ReturnType<typeof postgres>

  beforeAll(async () => {
    su = postgres(adminUrl(), { max: 1, prepare: false, onnotice: () => {} })
    await su.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    await su.unsafe(`CREATE DATABASE ${name} OWNER rms_migrator`)
  })
  afterAll(async () => {
    await su.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
    await su.end()
  })

  async function migrate() {
    const proc = Bun.spawn(['bun', 'scripts/migrate.ts'], {
      cwd: ROOT,
      env: { ...process.env, MIGRATION_DATABASE_URL: withDatabase(migratorUrl(), name) } as Record<
        string,
        string
      >,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { out, err, code }
  }

  const aclHash = async () => {
    const conn = postgres(withDatabase(adminUrl(), name), { max: 1, prepare: false })
    const rows =
      await conn`SELECT md5(string_agg(n.nspname || '.' || c.relname || ':' || coalesce(c.relacl::text, ''), ',' ORDER BY n.nspname, c.relname)) AS h
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'platform' AND c.relkind IN ('r', 'S')`
    await conn.end()
    return rows[0]?.h
  }

  test('it creates the fourteen schemas and the platform tables, grants the roles, and a second run changes nothing', async () => {
    const first = await migrate()
    expect(first.code).toBe(0)
    expect(first.out).toContain('bootstrap applied')
    expect(first.out).toContain('migrated: 0 pending applied, 14 schemas')
    expect(first.out).toContain('grants applied')
    const hash = await aclHash()
    expect(hash).toBeTruthy()
    const second = await migrate()
    expect(second.code).toBe(0)
    expect(await aclHash()).toBe(hash)
  })

  test('it fails with a non-zero exit and a message when the URL is wrong', async () => {
    const proc = Bun.spawn(['bun', 'scripts/migrate.ts'], {
      cwd: ROOT,
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: `postgres://rms_migrator:wrong@127.0.0.1:1/${name}`,
      } as Record<string, string>,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
    expect(code).toBe(1)
    expect(err).toContain('db:migrate failed')
  })
})
