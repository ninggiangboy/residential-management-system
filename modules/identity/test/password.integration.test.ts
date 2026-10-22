import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
} from '@core/kernel'
import { TokenInvalidError } from '../src/domain/errors'
import { createHarness, type Harness, linkTokenOf, PASSWORD } from './support'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

const NEW_PASSWORD = 'NewPassw0rd1'
let ipCounter = 0
/** Each test has its own address: the reset buckets are keyed by IP and spend the database clock, which a test cannot move. */
const nextIp = () => `192.0.2.${++ipCounter}`
const MINUTE = 60_000

const reasonOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a failure')
}

async function requestReset(email: string, ip = nextIp()) {
  await h.identity.useCases.requestPasswordReset.execute({ email, ip })
  const [mail] = await h.deliverMail()
  if (!mail) throw new Error('no mail')
  return linkTokenOf(mail)
}

describe('password reset (DOC-26 §4.3)', () => {
  test('AU-05: the link works once and until 30 minutes; at 30 minutes 1 second it does not', async () => {
    const staff = await h.seedStaff()
    const token = await requestReset(staff.email)
    h.clock.advance(29 * MINUTE + 59_000)
    await h.identity.useCases.setPassword.execute({ token, password: NEW_PASSWORD })
    // used once
    expect(
      await reasonOf(h.identity.useCases.setPassword.execute({ token, password: NEW_PASSWORD })),
    ).toBeInstanceOf(TokenInvalidError)
    // the new password signs in
    await h.signIn(staff.email, NEW_PASSWORD, { ip: nextIp() })

    const other = await h.seedStaff()
    const late = await requestReset(other.email)
    h.clock.advance(30 * MINUTE + 1000)
    expect(
      await reasonOf(h.identity.useCases.setPassword.execute({ token: late, password: PASSWORD })),
    ).toBeInstanceOf(TokenInvalidError)
  })

  test('AU-05: a newer link voids the older', async () => {
    const staff = await h.seedStaff()
    const older = await requestReset(staff.email)
    const newer = await requestReset(staff.email)
    expect(
      await reasonOf(h.identity.useCases.setPassword.execute({ token: older, password: PASSWORD })),
    ).toBeInstanceOf(TokenInvalidError)
    await h.identity.useCases.setPassword.execute({ token: newer, password: PASSWORD })
  })

  test('AU-06: a known and an unknown email answer alike; 4 requests for an email and 11 from an IP are 429', async () => {
    const staff = await h.seedStaff()
    const ip = nextIp()
    const known = await h.identity.useCases.requestPasswordReset.execute({ email: staff.email, ip })
    const unknown = await h.identity.useCases.requestPasswordReset.execute({
      email: 'nobody@sunrise.example',
      ip,
    })
    expect(known).toBeUndefined()
    expect(unknown).toBeUndefined()
    const mails = await h.deliverMail()
    expect(mails).toHaveLength(1)
    expect(mails[0]?.to).toBe(staff.email)

    // the 2nd and 3rd request for the email pass, the 4th is 429
    await h.identity.useCases.requestPasswordReset.execute({ email: staff.email, ip })
    await h.identity.useCases.requestPasswordReset.execute({ email: staff.email, ip })
    expect(
      await reasonOf(h.identity.useCases.requestPasswordReset.execute({ email: staff.email, ip })),
    ).toBeInstanceOf(RateLimitedError)

    // 10 requests from one IP pass (the unknown email above was one), the 11th is 429 whatever the email
    const crowded = nextIp()
    for (let n = 0; n < 10; n++)
      await h.identity.useCases.requestPasswordReset.execute({
        email: `crowd${n}@sunrise.example`,
        ip: crowded,
      })
    const eleventh = await reasonOf(
      h.identity.useCases.requestPasswordReset.execute({
        email: 'crowd11@sunrise.example',
        ip: crowded,
      }),
    )
    expect(eleventh).toBeInstanceOf(RateLimitedError)
    expect((eleventh as DomainError).retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })

  test('an invited, a locked and a disabled account get no link, and still get the same answer', async () => {
    await h.deliverMail() // what the tests before left in the outbox
    for (const status of ['invited', 'locked', 'disabled'] as const) {
      const staff = await h.seedStaff({ status })
      await h.identity.useCases.requestPasswordReset.execute({ email: staff.email, ip: nextIp() })
    }
    expect(await h.deliverMail()).toHaveLength(0)
  })

  test('AU-07: the rule is checked first, so a weak password does not burn the link', async () => {
    const staff = await h.seedStaff()
    const token = await requestReset(staff.email)
    for (const weak of ['abcdefgh', '12345678', 'abc1234', `a1${'x'.repeat(127)}`]) {
      const error = await reasonOf(
        h.identity.useCases.setPassword.execute({ token, password: weak }),
      )
      expect(error, weak).toBeInstanceOf(DomainError)
      expect((error as DomainError).code).toBe('validation_failed')
      expect((error as DomainError).details).toEqual([
        expect.objectContaining({ path: 'password', code: 'password_weak' }),
      ])
    }
    // the same link still works, with a password that follows the rule
    await h.identity.useCases.setPassword.execute({ token, password: 'abc12345' })
    await h.signIn(staff.email, 'abc12345', { ip: nextIp() })
  })

  test('AU-08: a reset clears a temporary lock, signs the person out everywhere, and never unlocks a manual lock', async () => {
    const staff = await h.seedStaff({
      failedAttempts: 5,
      lockedUntil: new Date(h.clock.now().getTime() + 10 * MINUTE),
    })
    await expect(h.signIn(staff.email, PASSWORD, { ip: nextIp() })).rejects.toMatchObject({
      code: 'account_locked',
    })

    // a person with a session: the reset ends it
    const other = await h.seedStaff()
    const opened = await h.signIn(other.email, PASSWORD, { ip: nextIp() })
    const token = await requestReset(other.email)
    await h.identity.useCases.setPassword.execute({ token, password: NEW_PASSWORD })
    await expect(
      h.identity.useCases.refreshSession.execute({ refreshToken: opened.session.refreshToken }),
    ).rejects.toMatchObject({
      code: 'unauthenticated',
    })
    const revoked = await h.db
      .sql`SELECT revoked_reason FROM identity.refresh_family WHERE account_id = ${other.id}`
    expect(revoked.map((r) => r.revoked_reason)).toEqual(['password_changed'])
    expect(await h.outboxOf('identity.session_revoked.v1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({ accountId: other.id, reason: 'password_changed' }),
        }),
      ]),
    )

    // the temporarily locked account resets and signs in at once
    const lockedToken = await requestReset(staff.email)
    await h.identity.useCases.setPassword.execute({ token: lockedToken, password: NEW_PASSWORD })
    await h.signIn(staff.email, NEW_PASSWORD, { ip: nextIp() })

    // a manual lock after the link was issued: the link is refused and stays unconsumed (DR-150)
    const manual = await h.seedStaff()
    const manualToken = await requestReset(manual.email)
    await h.admin`UPDATE identity.staff_account SET status = 'locked' WHERE id = ${manual.id}`
    expect(
      await reasonOf(
        h.identity.useCases.setPassword.execute({ token: manualToken, password: NEW_PASSWORD }),
      ),
    ).toBeInstanceOf(TokenInvalidError)
    expect((await h.row(manual.id))?.status).toBe('locked')
    const links = await h.db
      .sql`SELECT consumed_at FROM identity.password_token WHERE staff_id = ${manual.id}`
    expect(links[0]?.consumed_at).toBeNull()
  })
})

describe('invite (DOC-26 §4.3, §4.4)', () => {
  const issue = async (staff: { id: string; buildingId: string }) => {
    await h.database.run(() =>
      h.identity.inviteIssuer.issue({ id: staff.id, buildingId: staff.buildingId, language: 'en' }),
    )
    const [mail] = await h.deliverMail()
    if (!mail) throw new Error('no mail')
    return mail
  }

  test('AU-13: an invite works at 23 hours; at 25 hours it is refused, the account stays invited, and a resend works', async () => {
    const early = await h.seedStaff({ status: 'invited', password: null, role: 'guard' })
    const late = await h.seedStaff({ status: 'invited', password: null, role: 'technician' })
    const earlyMail = await issue(early)
    expect(earlyMail.subject).toBe('Set your password')
    expect(earlyMail.text).toContain('https://admin.example.vn/invite?token=')
    expect(earlyMail.text).toContain('expires in 24 hours')
    const lateToken = linkTokenOf(await issue(late))

    h.clock.advance(23 * 60 * MINUTE)
    await h.identity.useCases.setPassword.execute({
      token: linkTokenOf(earlyMail),
      password: NEW_PASSWORD,
    })
    expect((await h.row(early.id))?.status).toBe('active')
    await h.signIn(early.email, NEW_PASSWORD, { ip: nextIp() })

    h.clock.advance(2 * 60 * MINUTE)
    expect(
      await reasonOf(
        h.identity.useCases.setPassword.execute({ token: lateToken, password: NEW_PASSWORD }),
      ),
    ).toBeInstanceOf(TokenInvalidError)
    expect((await h.row(late.id))?.status).toBe('invited')

    // an Admin resends; the new link works
    const admin = await h.seedStaff({ role: 'admin' })
    await h.identity.useCases.resendStaffInvite.execute(admin.context, late.id)
    const [resent] = await h.deliverMail()
    if (!resent) throw new Error('no mail')
    await h.identity.useCases.setPassword.execute({
      token: linkTokenOf(resent),
      password: NEW_PASSWORD,
    })
    expect((await h.row(late.id))?.status).toBe('active')
  })

  test('a resend writes the audit row, and a newer invite voids the older', async () => {
    const admin = await h.seedStaff({ role: 'admin' })
    const invited = await h.seedStaff({ status: 'invited', password: null, role: 'guard' })
    const older = linkTokenOf(await issue(invited))
    await h.identity.useCases.resendStaffInvite.execute(admin.context, invited.id)
    const [newer] = await h.deliverMail()
    expect(
      await reasonOf(
        h.identity.useCases.setPassword.execute({ token: older, password: NEW_PASSWORD }),
      ),
    ).toBeInstanceOf(TokenInvalidError)
    expect(newer).toBeDefined()
    const rows = await h.db.sql`
      SELECT action, object_type, object_id, details, actor_role FROM audit.audit_log
       WHERE action = 'identity.staff.update' AND object_id = ${invited.id}`
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      object_type: 'staff_account',
      actor_role: 'admin',
      details: { invite: 'resent' },
    })
  })

  test('AU-19: a Manager resends for a Technician or a Guard, and is refused for an Admin or a Manager', async () => {
    const manager = await h.seedStaff({ role: 'manager' })
    const technician = await h.seedStaff({ status: 'invited', password: null, role: 'technician' })
    await h.identity.useCases.resendStaffInvite.execute(manager.context, technician.id)
    for (const role of ['admin', 'manager'] as const) {
      const target = await h.seedStaff({ status: 'invited', password: null, role })
      expect(
        await reasonOf(h.identity.useCases.resendStaffInvite.execute(manager.context, target.id)),
      ).toBeInstanceOf(ForbiddenError)
    }
    // a Technician and a Guard are not allowed to resend at all
    const guard = await h.seedStaff({ role: 'guard' })
    expect(
      await reasonOf(h.identity.useCases.resendStaffInvite.execute(guard.context, technician.id)),
    ).toBeInstanceOf(ForbiddenError)
  })

  test('a resend is only for an invited account, and another building looks missing', async () => {
    const admin = await h.seedStaff({ role: 'admin' })
    const active = await h.seedStaff({ role: 'guard' })
    const refused = await reasonOf(
      h.identity.useCases.resendStaffInvite.execute(admin.context, active.id),
    )
    expect(refused).toBeInstanceOf(ConflictError)
    expect((refused as DomainError).code).toBe('invalid_transition')
    const foreign = await h.seedStaff({
      status: 'invited',
      password: null,
      buildingId: '018f0000-0000-7000-8000-000000000002' as never,
    })
    expect(
      await reasonOf(h.identity.useCases.resendStaffInvite.execute(admin.context, foreign.id)),
    ).toBeInstanceOf(NotFoundError)
  })
})
