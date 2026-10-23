import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHarness, type Harness } from './support'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

const DAY = 86_400_000
const refresh = (refreshToken: string) =>
  h.identity.useCases.refreshSession.execute({ refreshToken })
const revokedEvents = async (reason?: string) =>
  (await h.outboxOf('identity.session_revoked.v1')).filter(
    (row) => reason === undefined || row.payload.reason === reason,
  )
const familyOf = async (sid: string) =>
  (
    await h.db
      .sql`SELECT revoked_at, revoked_reason, kind, client FROM identity.refresh_family WHERE id = ${sid}`
  )[0]
const asResident = (accountId: string, sessionId: string) =>
  ({ accountId, sessionId }) as Parameters<typeof h.identity.queries.sessions.listResident>[0]

describe('a resident session (DOC-26 §3)', () => {
  test('a refresh rotates the token, keeps the session and the resident claims', async () => {
    const { resident, answer, sid } = await h.signInResident()
    h.clock.advance(60_000)
    const next = await refresh(answer.session.refreshToken)
    expect(next.refreshToken).not.toBe(answer.session.refreshToken)
    expect(next.client).toBe('app')
    const claims = await h.identity.verifier.verify(next.accessToken)
    expect(claims).toEqual(expect.objectContaining({ kind: 'resident', sub: resident.id, sid }))
    expect(claims).not.toHaveProperty('role')
  })

  test('AU-35: a resident token lives 180 days from its last use and the family 365 days from sign-in', async () => {
    const { answer } = await h.signInResident()
    h.clock.advance(179 * DAY)
    const at179 = await refresh(answer.session.refreshToken)
    h.clock.advance(181 * DAY)
    await expect(refresh(at179.refreshToken)).rejects.toMatchObject({ code: 'unauthenticated' })

    const { answer: other } = await h.signInResident()
    let token = other.session.refreshToken
    for (let day = 170; day < 360; day += 170) {
      h.clock.advance(170 * DAY)
      token = (await refresh(token)).refreshToken
      void day
    }
    // 340 days in; the next extension is cut at day 365 and the one after is refused
    h.clock.advance(20 * DAY)
    token = (await refresh(token)).refreshToken
    h.clock.advance(6 * DAY)
    await expect(refresh(token)).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  test('AU-32: a rotated token used again 11 seconds later revokes the family, committed', async () => {
    const { answer, sid } = await h.signInResident()
    const next = await refresh(answer.session.refreshToken)
    h.clock.advance(11_000)
    await expect(refresh(answer.session.refreshToken)).rejects.toMatchObject({
      code: 'unauthenticated',
    })
    expect(await familyOf(sid)).toMatchObject({ revoked_reason: 'token_reuse' })
    await expect(refresh(next.refreshToken)).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  test('AU-37: a deleted account ends its family with `deleted`; one that requested deletion still refreshes', async () => {
    const { resident, answer, sid } = await h.signInResident()
    await h.admin`
      UPDATE identity.resident_account SET status = 'deletion_requested', deletion_requested_at = now() WHERE id = ${resident.id}`
    const next = await refresh(answer.session.refreshToken)
    await h.admin`
      UPDATE identity.resident_account
         SET status = 'deleted', display_name = NULL, phone = 'deleted:' || id, deleted_at = now() WHERE id = ${resident.id}`
    const before = (await revokedEvents('deleted')).length
    await expect(refresh(next.refreshToken)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(await familyOf(sid)).toMatchObject({ revoked_reason: 'deleted' })
    expect(await revokedEvents('deleted')).toHaveLength(before + 1)
  })

  test('AU-34: the eleventh sign-in of one account revokes the oldest family with cap_exceeded and one event', async () => {
    // the phone bucket of the default harness (5 an hour) would stop the tenth request
    const roomy = await createHarness({ config: { otpPerPhonePerHour: 100, otpPerIpPerHour: 100 } })
    try {
      const first = await roomy.signInResident()
      const sids = [first.sid]
      for (let i = 0; i < 10; i++) {
        roomy.clock.advance(60_000)
        const requested = await roomy.requestOtp(first.resident.phone, `198.19.1.${i}`)
        const sms = (await roomy.deliverSms()).find(
          (message) => message.to === first.resident.phone,
        )
        const signedIn = await roomy.verifyOtp(
          requested.challengeId,
          /^(\d{6}) /.exec(sms?.text ?? '')?.[1] ?? '',
        )
        sids.push((await roomy.identity.verifier.verify(signedIn.session.accessToken)).sid)
      }
      const live = await roomy.db
        .sql`SELECT id FROM identity.refresh_family WHERE account_id = ${first.resident.id} AND revoked_at IS NULL`
      expect(live).toHaveLength(10)
      const [oldest] = await roomy.db
        .sql`SELECT revoked_reason FROM identity.refresh_family WHERE id = ${sids[0] as string}`
      expect(oldest?.revoked_reason).toBe('cap_exceeded')
      const events = (await roomy.outboxOf('identity.session_revoked.v1')).filter(
        (row) => row.payload.reason === 'cap_exceeded',
      )
      expect(events).toHaveLength(1)
    } finally {
      await roomy.close()
    }
  })

  test('logout with the refresh token ends the family with sign_out', async () => {
    const { answer, sid } = await h.signInResident()
    await h.identity.useCases.signOut.execute({ refreshToken: answer.session.refreshToken })
    expect(await familyOf(sid)).toMatchObject({ revoked_reason: 'sign_out' })
  })
})

describe('the session list and revoke (DOC-26 §3.7)', () => {
  test('AU-55: the list marks the current session; the device label is model and OS', async () => {
    const { resident, sid } = await h.signInResident()
    const other = await h.requestOtp(resident.phone, '198.19.2.1')
    h.clock.advance(60_000)
    const sms = (await h.deliverSms()).find((message) => message.to === resident.phone)
    const second = await h.verifyOtp(
      other.challengeId,
      /^(\d{6}) /.exec(sms?.text ?? '')?.[1] ?? '',
      {
        userAgent: 'rms-resident/1.0.0 (Android 16; Pixel 9)',
      },
    )
    const secondSid = (await h.identity.verifier.verify(second.session.accessToken)).sid
    const items = await h.identity.queries.sessions.listResident(asResident(resident.id, secondSid))
    expect(items).toHaveLength(2)
    expect(items.find((item) => item.id === secondSid)).toMatchObject({
      current: true,
      client: 'app',
      device: 'Pixel 9, Android 16',
    })
    expect(items.find((item) => item.id === sid)).toMatchObject({
      current: false,
      device: 'iPhone17,1, iOS 19.1',
    })
  })

  test("AU-31: a resident revokes one of their sessions; another account's session id is 404", async () => {
    const mine = await h.signInResident()
    const theirs = await h.signInResident()
    const before = (await revokedEvents('user_revoked')).length
    await expect(
      h.identity.useCases.revokeResidentSession.execute(
        asResident(mine.resident.id, mine.sid),
        theirs.sid,
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(await familyOf(theirs.sid)).toMatchObject({ revoked_at: null })

    await h.identity.useCases.revokeResidentSession.execute(
      asResident(mine.resident.id, mine.sid),
      mine.sid,
    )
    expect(await familyOf(mine.sid)).toMatchObject({ revoked_reason: 'user_revoked' })
    expect(await revokedEvents('user_revoked')).toHaveLength(before + 1)
    await expect(refresh(mine.answer.session.refreshToken)).rejects.toMatchObject({
      code: 'unauthenticated',
    })
    // a staff session id is not a resident's to revoke either
    const staff = await h.seedStaff()
    const staffSession = await h.signIn(staff.email)
    await expect(
      h.identity.useCases.revokeResidentSession.execute(
        asResident(mine.resident.id, mine.sid),
        await h.sidOf(staffSession.session.accessToken),
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  test('GET /me: the account and the active memberships', async () => {
    const { resident } = await h.signInResident()
    h.memberships.set(resident.id, [
      {
        membershipId: h.ids.next(),
        unitId: h.ids.next(),
        unitCode: 'A-0703',
        memberType: 'tenant',
        canPay: false,
      },
    ])
    const me = await h.identity.queries.residents.me(asResident(resident.id, h.ids.next()))
    expect(me.account).toMatchObject({ id: resident.id, phone: resident.phone })
    expect(me.memberships).toHaveLength(1)
  })
})
