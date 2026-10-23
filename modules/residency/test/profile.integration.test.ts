import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { DomainError } from '@core/kernel'
import { cccdAad } from '../src/domain/resident-profile'
import { BUILDING, createHarness, type Harness, OTHER_BUILDING } from './support'

/** `UpdateProfile` on PostgreSQL 18.6 (DOC-27 §5.3): the sealed ID number, the version and the scope (RM-38, RM-39). */

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

const failure = async (promise: Promise<unknown>): Promise<DomainError> => {
  try {
    await promise
  } catch (error) {
    return error as DomainError
  }
  throw new Error('expected a failure')
}

const update = (
  accountId: string,
  edit: Parameters<Harness['residency']['useCases']['updateProfile']['execute']>[2]['edit'],
  version: number | undefined,
  staff = h.staff(),
) => h.residency.useCases.updateProfile.execute(staff, accountId, { edit, version })

const profile = async (accountId: string) => {
  const [row] =
    await h.admin`SELECT * FROM residency.resident_profile WHERE account_id = ${accountId}`
  return row
}

describe('UpdateProfile', () => {
  test('RM-38 the number is sealed with the PII key and its AAD, with the last four digits beside it', async () => {
    const accountId = crypto.randomUUID()
    await h.seedProfile(accountId)
    await update(accountId, { cccd: '079 085 012 345', email: 'an@example.com' }, 1)
    const row = await profile(accountId)
    expect(row).toMatchObject({ cccd_last4: '2345', email: 'an@example.com', version: 2 })
    expect(row?.cccd_enc).toMatch(/^v1:k1:/)
    expect(row?.cccd_enc).not.toContain('079085012345')
    expect(await h.pii.open(cccdAad(BUILDING, accountId), row?.cccd_enc)).toBe('079085012345')
    // The blob opens nowhere else: not for another account, not for another building.
    await expect(
      h.pii.open(cccdAad(BUILDING, crypto.randomUUID()), row?.cccd_enc),
    ).rejects.toThrow()
    await expect(h.pii.open(cccdAad(OTHER_BUILDING, accountId), row?.cccd_enc)).rejects.toThrow()
  })

  test('RM-38 a malformed number is 400 format and writes nothing; null clears both columns', async () => {
    const accountId = crypto.randomUUID()
    await h.seedProfile(accountId)
    for (const bad of ['12a4', '12345678901', '1234567890123']) {
      const error = await failure(update(accountId, { cccd: bad }, 1))
      expect(error.code).toBe('validation_failed')
      expect(JSON.stringify(error.details)).toContain('format')
    }
    expect((await profile(accountId))?.version).toBe(1)
    await update(accountId, { cccd: '123456789' }, 1)
    await update(accountId, { cccd: null }, 2)
    expect(await profile(accountId)).toMatchObject({ cccd_enc: null, cccd_last4: null, version: 3 })
  })

  test('RM-39 a stale or missing If-Match is 409 version_conflict or 428; two edits with one version, one wins', async () => {
    const accountId = crypto.randomUUID()
    await h.seedProfile(accountId)
    await update(accountId, { note: 'first' }, 1)
    expect((await failure(update(accountId, { note: 'second' }, 1))).code).toBe('version_conflict')
    expect((await failure(update(accountId, { note: 'second' }, undefined))).code).toBe(
      'precondition_required',
    )
    const results = await Promise.allSettled([
      update(accountId, { note: 'a' }, 2),
      update(accountId, { note: 'b' }, 2),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await profile(accountId))?.version).toBe(3)
  })

  test('an account with no profile in this building is 404, which is how a Manager is tied to a person (DR-136)', async () => {
    const elsewhere = crypto.randomUUID()
    await h.seedProfile(elsewhere, OTHER_BUILDING)
    expect((await failure(update(elsewhere, { note: 'x' }, 1))).code).toBe('not_found')
    expect((await failure(update(crypto.randomUUID(), { note: 'x' }, 1))).code).toBe('not_found')
    expect((await failure(update(elsewhere, { note: 'x' }, 1, h.staff('technician')))).code).toBe(
      'forbidden',
    )
  })

  test('the audit row lists the fields changed, all masked, and an edit that changes nothing writes none', async () => {
    const accountId = crypto.randomUUID()
    await h.seedProfile(accountId)
    await update(
      accountId,
      { fullName: 'Trần Thị Bình', cccd: '079085012345', dateOfBirth: '1985-04-03' },
      1,
    )
    const [audit] = await h.db.sql`
      SELECT action, changes FROM audit.audit_log WHERE object_id = ${accountId} ORDER BY at DESC LIMIT 1`
    expect(audit?.action).toBe('residency.profile.update')
    const text = JSON.stringify(audit?.changes)
    expect(text).toContain('[masked]')
    expect(text).not.toContain('Trần')
    expect(text).not.toContain('079085012345')
    expect(text).not.toContain('1985-04-03')
    await update(accountId, { fullName: 'Trần Thị Bình' }, 2)
    expect((await profile(accountId))?.version).toBe(2)
  })

  test('a date of birth in the future is refused', async () => {
    const accountId = crypto.randomUUID()
    await h.seedProfile(accountId)
    expect((await failure(update(accountId, { dateOfBirth: '2026-10-21' }, 1))).code).toBe(
      'validation_failed',
    )
    await update(accountId, { dateOfBirth: '2026-10-20' }, 1)
  })
})
