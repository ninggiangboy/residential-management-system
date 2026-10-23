import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { DomainError } from '@core/kernel'
import { createHarness, type Harness } from './support'

/** The two resident calls `residency` makes (DOC-18 §1.5, DOC-27 §9.2 step 4, DOC-09 §7.3). */

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

const api = () => h.identity.api

describe('findResidentAccountsByPhones', () => {
  test('finds active and deletion-requested accounts by E.164 and nothing else', async () => {
    const active = await h.seedResident({ displayName: 'An' })
    const leaving = await h.seedResident({ status: 'deletion_requested' })
    // A deleted account has lost its number (`deleted:<id>`), so no E.164 can match it.
    const goneId = crypto.randomUUID()
    await h.db.sql`INSERT INTO identity.resident_account (id, phone, status, deleted_at)
                   VALUES (${goneId}, ${`deleted:${goneId}`}, 'deleted', now())`
    const gone = { phone: `deleted:${goneId}` }
    const found = await api().findResidentAccountsByPhones([
      active.phone,
      leaving.phone,
      gone.phone,
      '+84999999999',
    ])
    expect(found.map((match) => [match.phone, match.accountId, match.status]).sort()).toEqual(
      [
        [active.phone, active.id, 'active'],
        [leaving.phone, leaving.id, 'deletion_requested'],
      ].sort(),
    )
    expect(found.find((match) => match.accountId === active.id)?.displayName).toBe('An')
  })

  test('no phones, no query; more than 5,000 is a defect of the caller', async () => {
    expect(await api().findResidentAccountsByPhones([])).toEqual([])
    const phones = Array.from({ length: 5001 }, (_, i) => `+8490${String(i).padStart(7, '0')}`)
    expect(api().findResidentAccountsByPhones(phones)).rejects.toThrow(RangeError)
  })
})

describe('findOrCreateResidentAccount', () => {
  test('creates the account once and an existing one keeps its name', async () => {
    const first = await api().findOrCreateResidentAccount('0912000001', 'Trần Thị Bình')
    expect(first.created).toBe(true)
    const again = await api().findOrCreateResidentAccount('+84 912 000 001', 'Someone Else')
    expect(again).toEqual({ accountId: first.accountId, created: false })
    const [account] = await h.db
      .sql`SELECT phone, display_name, status, language FROM identity.resident_account WHERE id = ${first.accountId}`
    expect(account).toEqual({
      phone: '+84912000001',
      display_name: 'Trần Thị Bình',
      status: 'active',
      language: 'vi',
    })
  })

  test('an existing account is returned whatever the name asked for', async () => {
    const existing = await h.seedResident({ displayName: 'Kept' })
    expect(await api().findOrCreateResidentAccount(existing.phone, 'Other')).toEqual({
      accountId: existing.id,
      created: false,
    })
  })

  test('a number that is not valid is a validation error and creates nothing', async () => {
    const error = await api()
      .findOrCreateResidentAccount('0123456789', 'Nobody')
      .catch((thrown: DomainError) => thrown)
    expect(error).toMatchObject({
      code: 'validation_failed',
      details: [{ path: 'phone', code: 'phone_invalid' }],
    })
    const [count] = await h.db
      .sql`SELECT count(*)::int AS n FROM identity.resident_account WHERE phone = '+84123456789'`
    expect(count?.n).toBe(0)
  })

  test('five callers at once for one phone make one account', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => api().findOrCreateResidentAccount('0912000002', 'Race')),
    )
    expect(new Set(results.map((result) => result.accountId)).size).toBe(1)
    expect(results.filter((result) => result.created)).toHaveLength(1)
  })
})
