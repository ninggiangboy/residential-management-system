import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database, SqlIdempotencyStore } from '@core/db'
import { cloneTemplate, type TestDb } from '@rms/test-support'

/** `platform.idempotency_key` through the adapter (DOC-17 §3, DOC-50 §8.3): the claim, the lock wait, the sweep (DLC-06). */

let db: TestDb
let database: Database
let store: SqlIdempotencyStore
const account = { kind: 'staff', id: crypto.randomUUID() } as const
const hash = 'a'.repeat(64)

beforeAll(async () => {
  db = await cloneTemplate('empty')
  database = new Database({ url: db.url, poolMax: 10, prepare: false })
  store = new SqlIdempotencyStore(database)
})
afterAll(async () => {
  await database.close()
  await db.drop()
})

describe('the adapter', () => {
  test('claim makes the row once; complete stores the response; find reads it back', async () => {
    expect(await store.claim(account, 'store-key-1', hash)).toBe(true)
    expect(await store.claim(account, 'store-key-1', hash)).toBe(false)
    expect((await store.find(account, 'store-key-1'))?.status).toBe('in_progress')
    await store.complete(account, 'store-key-1', {
      status: 201,
      body: { headers: {}, body: { id: 1 } },
    })
    expect(await store.find(account, 'store-key-1')).toMatchObject({
      status: 'completed',
      responseStatus: 201,
      responseBody: { headers: {}, body: { id: 1 } },
      requestHash: hash,
    })
    expect(await store.find({ ...account, id: crypto.randomUUID() }, 'store-key-1')).toBeNull()
  })

  test('a claim waits for a transaction that has not finished: commit gives zero rows, rollback gives one', async () => {
    const commits = async (outcome: 'commit' | 'rollback', key: string) => {
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const first = store
        .transaction(async () => {
          await store.claim(account, key, hash)
          await gate
          if (outcome === 'rollback') throw new Error('rolled back')
        })
        .catch(() => {})
      await Bun.sleep(30)
      let settled = false
      const second = store.claim(account, key, hash).then((inserted) => {
        settled = true
        return inserted
      })
      await Bun.sleep(100)
      expect(settled).toBe(false)
      release()
      await first
      return second
    }
    expect(await commits('commit', 'store-key-2')).toBe(false)
    expect(await commits('rollback', 'store-key-3')).toBe(true)
  })

  test('release deletes a key; with a date only an in-progress key older than it', async () => {
    await store.claim(account, 'store-key-4', hash)
    expect(await store.release(account, 'store-key-4', new Date(Date.now() - 60_000))).toBe(false)
    expect(await store.release(account, 'store-key-4', new Date(Date.now() + 60_000))).toBe(true)
    await store.claim(account, 'store-key-5', hash)
    await store.complete(account, 'store-key-5', { status: 200, body: {} })
    expect(await store.release(account, 'store-key-5', new Date(Date.now() + 60_000))).toBe(false)
    expect(await store.release(account, 'store-key-5')).toBe(true)
  })

  test('DLC-06 the sweep deletes the key of 25 hours ago and keeps the fresh one', async () => {
    await store.claim(account, 'store-old-1', hash)
    await store.claim(account, 'store-new-1', hash)
    await db.sql`UPDATE platform.idempotency_key SET created_at = now() - interval '25 hours' WHERE key = 'store-old-1'`
    const deleted = await store.purge(new Date(Date.now() - 24 * 3_600_000))
    expect(deleted).toBeGreaterThanOrEqual(1)
    expect(await store.find(account, 'store-old-1')).toBeNull()
    expect(await store.find(account, 'store-new-1')).not.toBeNull()
  })
})
