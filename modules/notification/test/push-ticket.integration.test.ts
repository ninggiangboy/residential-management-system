import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Database } from '@core/db'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { DrizzleInboxEntryRepository } from '../src/infrastructure/persistence/drizzle-inbox-entry-repository'
import { DrizzlePushTicketRepository } from '../src/infrastructure/persistence/drizzle-push-ticket-repository'

/**
 * The conditional statements of the receipts and the purges against a real PostgreSQL (DOC-31 §7, §8, NT-70…NT-74, NT-80): the
 * claim with its lease and `FOR UPDATE SKIP LOCKED`, the settle that only moves a `pending` ticket, the unknown after 24 hours and
 * the batched purges.
 */

let db: TestDb
let database: Database
let tickets: DrizzlePushTicketRepository
let entries: DrizzleInboxEntryRepository

const message = crypto.randomUUID()
const seed = async (n: number) => {
  await db.sql.unsafe(`
    INSERT INTO notification.push_ticket
      (id, message_id, device_token_id, account_kind, account_id, template_key, source_kind, source_id, receipt_id, status, next_check_at)
    SELECT gen_random_uuid(), '${message}', gen_random_uuid(), 'resident', gen_random_uuid(), 'fee.reminder', 'debt_reminder',
           gen_random_uuid(), 'rcpt-' || g, 'pending', now() - interval '20 minutes'
      FROM generate_series(1, ${n}) g`)
}

beforeAll(async () => {
  db = await cloneTemplate('empty')
  database = new Database({ url: db.url, poolMax: 8, prepare: false })
  tickets = new DrizzlePushTicketRepository(database)
  entries = new DrizzleInboxEntryRepository(database)
})
afterAll(async () => {
  await database.close()
  await db.drop()
})

describe('NT-70 and NT-74: the claim', () => {
  test('1,500 due tickets are claimed 1,000 then 500, inside the lease, and two workers at once get disjoint sets', async () => {
    await seed(1500)
    const [a, b] = await Promise.all([tickets.claimDue(1000, 5), tickets.claimDue(1000, 5)])
    const ids = new Set([...a, ...b].map((row) => row.id))
    expect(ids.size).toBe(a.length + b.length) // no ticket claimed twice
    expect(a.length + b.length).toBeGreaterThanOrEqual(1000)
    expect(a.length + b.length).toBeLessThanOrEqual(1500)
    // the lease moved next_check_at, so an immediate third claim finds only what the first two left
    const rest = await tickets.claimDue(1000, 5)
    expect(rest.every((row) => !ids.has(row.id))).toBe(true)
    expect(ids.size + rest.length).toBe(1500)
    expect((await tickets.claimDue(1000, 5)).length).toBe(0)
  })
})

describe('settle and the unknown state', () => {
  test('a ticket moves out of pending once: of two settles at once exactly one wins', async () => {
    await db.sql`DELETE FROM notification.push_ticket`
    await seed(1)
    const [row] = await db.sql`SELECT id FROM notification.push_ticket`
    const id = row?.id as string
    const results = await Promise.all([
      tickets.settle(id, { status: 'ok', error: null }),
      tickets.settle(id, { status: 'failed', error: 'DeviceNotRegistered' }),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await tickets.settle(id, { status: 'ok', error: null })).toBe(false)
  })

  test('NT-71: a pending ticket older than 24 hours becomes unknown; a younger one stays', async () => {
    await db.sql`DELETE FROM notification.push_ticket`
    await seed(2)
    await db.sql`UPDATE notification.push_ticket SET created_at = now() - interval '25 hours' WHERE receipt_id = 'rcpt-1'`
    expect(await tickets.markUnknownOlderThan(24)).toBe(1)
    const rows =
      await db.sql`SELECT receipt_id, status FROM notification.push_ticket ORDER BY receipt_id`
    expect(rows.map((r) => r.status)).toEqual(['unknown', 'pending'])
    expect(await tickets.markUnknownOlderThan(24)).toBe(0)
  })

  test('NT-73: tickets older than the retention are purged in batches; a second run deletes nothing', async () => {
    await db.sql`DELETE FROM notification.push_ticket`
    await seed(2500)
    await db.sql`UPDATE notification.push_ticket SET created_at = now() - interval '4 days'`
    expect(await tickets.purgeOlderThan(3, 1000)).toBe(1000)
    expect(await tickets.purgeOlderThan(3, 1000)).toBe(1000)
    expect(await tickets.purgeOlderThan(3, 1000)).toBe(500)
    expect(await tickets.purgeOlderThan(3, 1000)).toBe(0)
  })
})

describe('NT-80: the inbox purge', () => {
  test('2,500 old entries are deleted 1,000, 1,000, 500 and a second run deletes none', async () => {
    const building = crypto.randomUUID()
    await db.sql`
      INSERT INTO notification.inbox_entry (id, building_id, account_kind, account_id, template_key, params, source_kind, source_id, dedupe_id, created_at)
      SELECT gen_random_uuid(), ${building}, 'resident', gen_random_uuid(), 'fee.reminder', '{}'::jsonb, 'debt_reminder',
             gen_random_uuid(), gen_random_uuid(), now() - interval '200 days'
        FROM generate_series(1, 2500)`
    const cutoff = new Date(Date.now() - 180 * 86_400_000)
    expect(await entries.purgeOlderThan(cutoff, 1000)).toBe(1000)
    expect(await entries.purgeOlderThan(cutoff, 1000)).toBe(1000)
    expect(await entries.purgeOlderThan(cutoff, 1000)).toBe(500)
    expect(await entries.purgeOlderThan(cutoff, 1000)).toBe(0)
  })
})
