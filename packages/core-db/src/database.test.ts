import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { Database } from './database'

// Needs the local PostgreSQL (`bun run infra:up`) and
//   TEST_ADMIN_DATABASE_URL=postgres://postgres:$RMS_POSTGRES_PASSWORD@localhost:$RMS_PG_PORT/postgres (DOC-88 §6).
// Skipped without it.
const url = process.env.TEST_ADMIN_DATABASE_URL
const pg = url ? describe : describe.skip

pg('Database transactions (against PostgreSQL)', () => {
  let database: Database
  const table = sql.raw('pg_temp.core_db_savepoint')

  beforeAll(() => {
    database = new Database({ url: url as string, poolMax: 1, prepare: false })
  })
  afterAll(() => database.close())

  const names = async () =>
    (
      await database.executor.execute<{ name: string }>(
        sql`select name from ${table} order by name`,
      )
    ).map((row) => row.name)

  // `pg_temp` lives as long as the connection; the pool has one, so the table is visible to every statement below.
  const create = () =>
    database.executor.execute(sql`create temp table if not exists core_db_savepoint (name text)`)
  const insert = (name: string) =>
    database.executor.execute(sql`insert into ${table} values (${name})`)

  test('run joins an open transaction: the inner failure rolls back everything', async () => {
    await create()
    await database.executor.execute(sql`truncate ${table}`)
    await expect(
      database.run(async () => {
        await insert('outer')
        await database.run(async () => {
          await insert('inner')
          throw new Error('boom')
        })
      }),
    ).rejects.toThrow('boom')
    expect(await names()).toEqual([])
  })

  test('transaction inside a transaction is a savepoint: only the inner writes are rolled back', async () => {
    await create()
    await database.executor.execute(sql`truncate ${table}`)
    await database.run(async () => {
      await insert('outer')
      await database
        .transaction(async () => {
          await insert('inner')
          throw new Error('boom')
        })
        .catch(() => undefined)
      await insert('after')
    })
    expect(await names()).toEqual(['after', 'outer'])
  })

  test('a released savepoint keeps its writes', async () => {
    await create()
    await database.executor.execute(sql`truncate ${table}`)
    await database.run(async () => {
      await insert('outer')
      await database.transaction(() => insert('inner'))
    })
    expect(await names()).toEqual(['inner', 'outer'])
  })

  test('autonomous commits on another connection even when the caller rolls back', async () => {
    const table = sql.raw(`public.core_db_autonomous_${Date.now()}`)
    const pool = new Database({ url: url as string, poolMax: 2, prepare: false })
    try {
      await pool.executor.execute(sql`create table ${table} (name text)`)
      await expect(
        pool.run(async () => {
          await pool.executor.execute(sql`insert into ${table} values ('outer')`)
          await pool.autonomous(async () => {
            expect(pool.inTransaction).toBe(true)
            await pool.executor.execute(sql`insert into ${table} values ('autonomous')`)
          })
          expect(pool.inTransaction).toBe(true)
          throw new Error('rollback the caller')
        }),
      ).rejects.toThrow('rollback the caller')
      const rows = await pool.executor.execute<{ name: string }>(sql`select name from ${table}`)
      expect(rows.map((row) => row.name)).toEqual(['autonomous'])
    } finally {
      await pool.executor.execute(sql`drop table if exists ${table}`)
      await pool.close()
    }
  })

  test('inTransaction is false outside and true inside', async () => {
    expect(database.inTransaction).toBe(false)
    await database.run(async () => expect(database.inTransaction).toBe(true))
  })
})
