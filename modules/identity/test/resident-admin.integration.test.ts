import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHarness, type Harness, otpOf } from './support'

/** What `residency` asks of `identity` for the staff API of P1-14 (DOC-26 §2.2, DOC-27 §2.2, §8, §11). */

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

const api = () => h.identity.api
/** A call of the contract inside the transaction of its caller, which rolls back when the call fails. */
const inTransaction = <T>(fn: () => Promise<T>) => h.database.run(fn)

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a failure')
}

describe('changeResidentPhone (AU-52, AU-S06)', () => {
  test('to a free number: every family ends with phone_changed and one event each', async () => {
    const { resident } = await h.signInResident()
    // A second device: a new code once the resend gate (45 s) has passed.
    h.clock.advance(60_000)
    const requested = await h.requestOtp(resident.phone, '198.51.100.60')
    const sms = (await h.deliverSms()).find((m) => m.to === resident.phone)
    await h.verifyOtp(requested.challengeId, otpOf(sms as never))
    const events = (await h.outboxOf('identity.session_revoked.v1')).length

    await inTransaction(() => api().changeResidentPhone(resident.id, '0987000001'))
    const [account] = await api().getResidentAccounts([resident.id])
    expect(account?.phone).toBe('+84987000001')
    const rows = await h.db
      .sql`SELECT revoked_reason FROM identity.refresh_family WHERE account_id = ${resident.id}`
    expect(rows.map((row) => row.revoked_reason)).toEqual(['phone_changed', 'phone_changed'])
    expect((await h.outboxOf('identity.session_revoked.v1')).length).toBe(events + 2)
    // The old number has no account any more: asking for a code is refused.
    expect(await failure(h.requestOtp(resident.phone, '198.51.100.61'))).toMatchObject({
      code: 'phone_not_registered',
    })
  })

  test('to a number with an account: 409 phone_in_use and nothing changes', async () => {
    const { resident } = await h.signInResident()
    const other = await h.seedResident()
    const events = (await h.outboxOf('identity.session_revoked.v1')).length
    expect(
      await failure(inTransaction(() => api().changeResidentPhone(resident.id, other.phone))),
    ).toMatchObject({ code: 'phone_in_use' })
    const [account] = await api().getResidentAccounts([resident.id])
    expect(account?.phone).toBe(resident.phone)
    const live = await h.db
      .sql`SELECT count(*)::int AS n FROM identity.refresh_family WHERE account_id = ${resident.id} AND revoked_at IS NULL`
    expect(live[0]?.n).toBe(1)
    expect((await h.outboxOf('identity.session_revoked.v1')).length).toBe(events)
  })

  test('the same number is a no-op; an invalid one is phone_invalid; an unknown or deleted account is not found', async () => {
    const { resident } = await h.signInResident()
    const events = (await h.outboxOf('identity.session_revoked.v1')).length
    await inTransaction(() => api().changeResidentPhone(resident.id, resident.phone))
    await inTransaction(() =>
      api().changeResidentPhone(resident.id, resident.phone.replace('+84', '0')),
    )
    expect((await h.outboxOf('identity.session_revoked.v1')).length).toBe(events)
    expect(
      await failure(inTransaction(() => api().changeResidentPhone(resident.id, 'abc'))),
    ).toMatchObject({ code: 'validation_failed', details: [{ code: 'phone_invalid' }] })
    expect(
      await failure(
        inTransaction(() => api().changeResidentPhone(crypto.randomUUID(), '0987000002')),
      ),
    ).toMatchObject({ code: 'not_found' })
    const goneId = crypto.randomUUID()
    await h.db.sql`INSERT INTO identity.resident_account (id, phone, status, deleted_at)
                   VALUES (${goneId}, ${`deleted:${goneId}`}, 'deleted', now())`
    expect(
      await failure(inTransaction(() => api().changeResidentPhone(goneId, '0987000003'))),
    ).toMatchObject({ code: 'not_found' })
  })
})

describe('queueMemberInvitation (AU-53)', () => {
  test('writes one member_invitation command that expires in 5 minutes and holds no phone', async () => {
    const resident = await h.seedResident()
    await inTransaction(() => api().queueMemberInvitation(resident.id, { unitCode: 'A-1508' }))
    const [row] = (await h.outboxOf('identity.sms_requested.v1')).slice(-1)
    expect(row?.payload).toMatchObject({
      kind: 'member_invitation',
      accountId: resident.id,
      params: { unitCode: 'A-1508' },
    })
    expect(JSON.stringify(row?.payload)).not.toContain(resident.phone)
    expect(Date.parse(row?.payload.expiresAt) - h.clock.now().getTime()).toBe(5 * 60_000)
    const texts = await h.deliverSms()
    expect(texts.find((t) => t.to === resident.phone)?.text).toContain('A-1508')
  })

  test('an empty OTP bucket of the phone is 429 and the caller rolls back', async () => {
    const resident = await h.seedResident()
    const before = (await h.outboxOf('identity.sms_requested.v1')).length
    // The bucket of the phone is the one the OTP draws from: five tokens an hour.
    for (let i = 0; i < h.config.otpPerPhonePerHour; i++)
      await inTransaction(() => api().queueMemberInvitation(resident.id, { unitCode: 'B-1' }))
    const sent = (await h.outboxOf('identity.sms_requested.v1')).length
    expect(sent).toBe(before + h.config.otpPerPhonePerHour)
    const error = await failure(
      inTransaction(async () => {
        await api().queueMemberInvitation(resident.id, { unitCode: 'B-1' })
      }),
    )
    expect(error).toMatchObject({ code: 'rate_limited' })
    expect((await h.outboxOf('identity.sms_requested.v1')).length).toBe(sent)
  })

  test('an unknown or deleted account is not found', async () => {
    expect(
      await failure(
        inTransaction(() => api().queueMemberInvitation(crypto.randomUUID(), { unitCode: 'A-1' })),
      ),
    ).toMatchObject({ code: 'not_found' })
  })
})

describe('findResidentAccountsByPhoneFragment (DOC-27 §11.1)', () => {
  test('finds by the end of the number, excludes deleted accounts, honours the limit', async () => {
    const one = await h.seedResident({ phone: '+84901234567', displayName: 'An' })
    await h.seedResident({ phone: '+84912234567', displayName: 'Bình' })
    await h.seedResident({ phone: '+84977777777', displayName: 'Cường' })
    const goneId = crypto.randomUUID()
    await h.db.sql`INSERT INTO identity.resident_account (id, phone, status, deleted_at)
                   VALUES (${goneId}, ${`deleted:${goneId}`}, 'deleted', now())`

    const found = await api().findResidentAccountsByPhoneFragment('4567', 50)
    expect(found.map((a) => a.displayName).sort()).toEqual(['An', 'Bình'])
    expect(found.find((a) => a.accountId === one.id)?.phone).toBe('+84901234567')
    expect(await api().findResidentAccountsByPhoneFragment('901234567', 50)).toHaveLength(1)
    expect(await api().findResidentAccountsByPhoneFragment('4567', 1)).toHaveLength(1)
    expect(await api().findResidentAccountsByPhoneFragment('0000', 50)).toEqual([])
    // Not a digit string, too short, or a limit above 500 is a defect of the caller.
    expect(api().findResidentAccountsByPhoneFragment('45', 50)).rejects.toThrow(RangeError)
    expect(api().findResidentAccountsByPhoneFragment("4567'; --", 50)).rejects.toThrow(RangeError)
    expect(api().findResidentAccountsByPhoneFragment('4567', 501)).rejects.toThrow(RangeError)
  })
})

describe('listDeletionRequests (DOC-09 §7.3, DR-125)', () => {
  test('lists accounts in deletion_requested, oldest first, with both dates and a keyset', async () => {
    const first = await h.seedResident({ status: 'deletion_requested' })
    const second = await h.seedResident({ status: 'deletion_requested' })
    const third = await h.seedResident({ status: 'deletion_requested' })
    await h.seedResident()
    await h.db
      .sql`UPDATE identity.resident_account SET deletion_approved_at = now() WHERE id = ${second.id}`

    const page = await api().listDeletionRequests({ limit: 2 })
    const ids = [first.id, second.id, third.id].sort()
    expect(page.items.map((i) => i.accountId)).toEqual(ids.slice(0, 2))
    expect(page.next).toBe(ids[1] as string)
    const rest = await api().listDeletionRequests({ after: page.next as string, limit: 2 })
    expect(rest.items.map((i) => i.accountId)).toEqual([ids[2] as string])
    expect(rest.next).toBeNull()
    const approved = [...page.items, ...rest.items].find((i) => i.accountId === second.id)
    expect(approved?.approvedAt).not.toBeNull()
    expect(approved?.requestedAt).toBe(h.clock.now().toISOString())
  })

  test('getResidentAccounts carries lastAppOpenAt', async () => {
    const resident = await h.seedResident()
    await h.db
      .sql`UPDATE identity.resident_account SET last_app_open_at = ${new Date('2026-10-20T01:02:11.000Z')} WHERE id = ${resident.id}`
    const other = await h.seedResident()
    const accounts = await api().getResidentAccounts([resident.id, other.id])
    expect(accounts.find((a) => a.accountId === resident.id)?.lastAppOpenAt).toBe(
      '2026-10-20T01:02:11.000Z',
    )
    expect(accounts.find((a) => a.accountId === other.id)?.lastAppOpenAt).toBeNull()
  })
})
