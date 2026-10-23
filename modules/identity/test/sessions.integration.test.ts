import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { NotFoundError } from '@core/kernel'
import { createHarness, type Harness, PASSWORD } from './support'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

const DAY = 86_400_000
let ipCounter = 0
const nextIp = () => `198.18.0.${++ipCounter}`

const refresh = (refreshToken: string) =>
  h.identity.useCases.refreshSession.execute({ refreshToken })
const events = async (reason?: string) =>
  (await h.outboxOf('identity.session_revoked.v1')).filter(
    (row) => reason === undefined || row.payload.reason === reason,
  )
const familyOf = async (sid: string) =>
  (
    await h.db.sql`SELECT revoked_at, revoked_reason FROM identity.refresh_family WHERE id = ${sid}`
  )[0]

async function signedIn(options: { role?: 'admin' | 'manager' } = {}) {
  const staff = await h.seedStaff({ role: options.role })
  const session = await h.signIn(staff.email, PASSWORD, { ip: nextIp() })
  return { staff, session, sid: await h.sidOf(session.session.accessToken) }
}

describe('refresh (DOC-26 §3.5)', () => {
  test('a refresh rotates the token, keeps the session, and signs with the role read now', async () => {
    const { staff, session, sid } = await signedIn()
    h.clock.advance(60_000)
    const next = await refresh(session.session.refreshToken)
    expect(next.refreshToken).not.toBe(session.session.refreshToken)
    expect(next.client).toBe('app')
    expect(await h.sidOf(next.accessToken)).toBe(sid)
    await h.admin`UPDATE identity.staff_account SET role = 'admin' WHERE id = ${staff.id}`
    const promoted = await refresh(next.refreshToken)
    expect(await h.identity.verifier.verify(promoted.accessToken)).toMatchObject({ role: 'admin' })
  })

  test('AU-32: a rotated token used again 11 seconds later revokes the whole family, and the revocation is committed', async () => {
    const { session, sid } = await signedIn()
    const next = await refresh(session.session.refreshToken)
    h.clock.advance(11_000)
    await expect(refresh(session.session.refreshToken)).rejects.toMatchObject({
      code: 'unauthenticated',
    })
    expect(await familyOf(sid)).toMatchObject({ revoked_reason: 'token_reuse' })
    // the successor died with the family
    await expect(refresh(next.refreshToken)).rejects.toMatchObject({ code: 'unauthenticated' })
    expect(await events('token_reuse')).toHaveLength(1)
  })

  test('AU-33: the same token twice inside 10 seconds is 200 twice, and both successors work', async () => {
    const { session } = await signedIn()
    const first = await refresh(session.session.refreshToken)
    h.clock.advance(3000)
    const second = await refresh(session.session.refreshToken)
    expect(second.refreshToken).not.toBe(first.refreshToken)
    await refresh(first.refreshToken)
    await refresh(second.refreshToken)
  })

  test('AU-33b: 10 parallel refreshes of one token spend it once and the rest take the grace path', async () => {
    const { session, sid } = await signedIn()
    const results = await Promise.all(
      Array.from({ length: 10 }, () => refresh(session.session.refreshToken)),
    )
    expect(new Set(results.map((result) => result.refreshToken)).size).toBe(10)
    const [spent] = await h.db
      .sql`SELECT count(*)::int AS n FROM identity.refresh_token WHERE family_id = ${sid} AND replaced_by_id IS NOT NULL`
    expect(spent?.n).toBe(1)
    const [all] = await h.db
      .sql`SELECT count(*)::int AS n FROM identity.refresh_token WHERE family_id = ${sid}`
    expect(all?.n).toBe(11)
    expect((await familyOf(sid))?.revoked_at).toBeNull()
  })

  test('AU-36: a token of a revoked family is 401 and writes no new event', async () => {
    const { staff, session, sid } = await signedIn()
    await h.identity.useCases.signOut.execute({ refreshToken: session.session.refreshToken })
    expect(await familyOf(sid)).toMatchObject({ revoked_reason: 'sign_out' })
    const before = (await events()).length
    await expect(refresh(session.session.refreshToken)).rejects.toMatchObject({
      code: 'unauthenticated',
    })
    expect((await events()).length).toBe(before)
    // a second logout is not an error and writes nothing either
    await h.identity.useCases.signOut.execute({ refreshToken: session.session.refreshToken })
    await h.identity.useCases.signOut.execute({ refreshToken: 'a-token-nobody-issued' })
    expect((await events()).length).toBe(before)
    expect(staff.id).toBeTruthy()
  })

  test('AU-35: staff refresh lives 30 days from the last use and 90 days from the sign-in', async () => {
    const day29 = await signedIn()
    h.clock.advance(29 * DAY)
    const alive = await refresh(day29.session.session.refreshToken)
    expect(alive.refreshExpiresAt.getTime() - h.clock.now().getTime()).toBe(30 * DAY)

    const day31 = await signedIn()
    h.clock.advance(31 * DAY)
    await expect(refresh(day31.session.session.refreshToken)).rejects.toMatchObject({
      code: 'unauthenticated',
    })

    // a family kept alive by a refresh every 29 days never passes day 90
    const kept = await signedIn()
    const started = h.clock.now().getTime()
    let token = kept.session.session.refreshToken
    for (const day of [29, 58, 87]) {
      h.clock.advance(started + day * DAY - h.clock.now().getTime())
      const result = await refresh(token)
      token = result.refreshToken
      if (day === 87) expect(result.refreshExpiresAt.getTime() - started).toBe(90 * DAY)
    }
    h.clock.advance(started + 91 * DAY - h.clock.now().getTime())
    await expect(refresh(token)).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  test('AU-37: a refresh finds a locked or disabled account and revokes the family; a temporary lock does not stop it', async () => {
    for (const [status, reason] of [
      ['locked', 'account_locked'],
      ['disabled', 'account_disabled'],
    ] as const) {
      const { staff, session, sid } = await signedIn()
      await h.admin`UPDATE identity.staff_account SET status = ${status} WHERE id = ${staff.id}`
      await expect(refresh(session.session.refreshToken)).rejects.toMatchObject({
        code: 'unauthenticated',
      })
      expect(await familyOf(sid), status).toMatchObject({ revoked_reason: reason })
    }
    const { staff, session } = await signedIn()
    const until = new Date(h.clock.now().getTime() + 600_000)
    await h.admin`UPDATE identity.staff_account SET locked_until = ${until}, failed_attempts = 5 WHERE id = ${staff.id}`
    await refresh(session.session.refreshToken)
  })

  test('a refresh that finds an inactive account does not leave a dangling successor', async () => {
    const { staff, session } = await signedIn()
    await h.admin`UPDATE identity.staff_account SET status = 'disabled' WHERE id = ${staff.id}`
    await expect(refresh(session.session.refreshToken)).rejects.toThrow()
    const tokens = await h.db.sql`
      SELECT t.replaced_by_id FROM identity.refresh_token t JOIN identity.refresh_family f ON f.id = t.family_id
       WHERE f.account_id = ${staff.id}`
    expect(tokens.every((row) => row.replaced_by_id === null)).toBe(true)
  })
})

describe('sessions (DOC-26 §3.6, §3.7)', () => {
  test('AU-31: an account ends one of its sessions; another account cannot', async () => {
    const staff = await h.seedStaff()
    const a = await h.signIn(staff.email, PASSWORD, { ip: nextIp() })
    h.clock.advance(1000)
    const b = await h.signIn(staff.email, PASSWORD, { ip: nextIp() })
    h.clock.advance(1000)
    await h.signIn(staff.email, PASSWORD, { ip: nextIp() })
    const sidA = await h.sidOf(a.session.accessToken)
    const sidB = await h.sidOf(b.session.accessToken)

    const stranger = await h.seedStaff()
    await expect(
      h.identity.useCases.revokeStaffSession.execute(stranger.context, sidA),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(await familyOf(sidA)).toMatchObject({ revoked_reason: null })

    await h.identity.useCases.revokeStaffSession.execute(staff.context, sidA)
    expect(await familyOf(sidA)).toMatchObject({ revoked_reason: 'user_revoked' })
    const tokens = await h.db
      .sql`SELECT revoked_at FROM identity.refresh_token WHERE family_id = ${sidA}`
    expect(tokens.every((row) => row.revoked_at !== null)).toBe(true)
    expect(await events('user_revoked')).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          sessionId: sidA,
          accountId: staff.id,
          accountKind: 'staff',
        }),
      }),
    ])
    await expect(refresh(a.session.refreshToken)).rejects.toMatchObject({ code: 'unauthenticated' })
    // the other two stay
    const listed = await h.identity.queries.sessions.listStaff(staff.context, sidB)
    expect(listed).toHaveLength(2)
    expect(listed.find((row) => row.id === sidB)?.current).toBe(true)
    // revoking the current session equals a logout
    await h.identity.useCases.revokeStaffSession.execute(staff.context, sidB)
    await expect(refresh(b.session.refreshToken)).rejects.toMatchObject({ code: 'unauthenticated' })
  })

  test('AU-34: the eleventh sign-in leaves ten live sessions and revokes the oldest as cap_exceeded', async () => {
    const staff = await h.seedStaff()
    const sids: string[] = []
    for (let n = 0; n < 11; n++) {
      const result = await h.signIn(staff.email, PASSWORD, { ip: nextIp() })
      sids.push(await h.sidOf(result.session.accessToken))
      h.clock.advance(1000)
    }
    const live = await h.db
      .sql`SELECT id FROM identity.refresh_family WHERE account_id = ${staff.id} AND revoked_at IS NULL`
    expect(live).toHaveLength(10)
    expect(await familyOf(sids[0] as string)).toMatchObject({ revoked_reason: 'cap_exceeded' })
    expect(await events('cap_exceeded')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ sessionId: sids[0] }) }),
    ])
  })

  test('AU-55: the list marks the current session, says web or app, and labels the device', async () => {
    const staff = await h.seedStaff()
    const chrome =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    const web = await h.signIn(staff.email, PASSWORD, {
      ip: nextIp(),
      client: 'web',
      userAgent: chrome,
    })
    h.clock.advance(1000)
    const app = await h.signIn(staff.email, PASSWORD, { ip: nextIp() })
    const sidWeb = await h.sidOf(web.session.accessToken)
    const sidApp = await h.sidOf(app.session.accessToken)
    const items = await h.identity.queries.sessions.listStaff(staff.context, sidApp)
    expect(items.map((row) => row.id)).toEqual([sidApp, sidWeb]) // the most recently used first
    expect(items[0]).toMatchObject({ client: 'app', device: 'iPhone17,1, iOS 19.1', current: true })
    expect(items[1]).toMatchObject({ client: 'web', device: 'Chrome on macOS', current: false })
  })
})
