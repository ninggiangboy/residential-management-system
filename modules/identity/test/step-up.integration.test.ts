import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { RateLimitedError } from '@core/kernel'
import type { StepUpAction } from '../src/contracts'
import { codeOf, createHarness, type Harness, PASSWORD } from './support'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

const MINUTE = 60_000

type Admin = Awaited<ReturnType<Harness['seedStaff']>>
const seedAdmin = () => h.seedStaff({ role: 'admin' })

/** `POST /staff/step-up` and the delivery of its mail; the code the Admin reads. */
async function requestCode(admin: Admin, action: StepUpAction = 'gateway_config') {
  await h.identity.useCases.requestStepUp.execute(admin.context, action)
  const mails = await h.deliverMail()
  const mail = mails.find((m) => m.to === admin.email && /\b\d{6}\b/.test(m.text))
  if (!mail) throw new Error('no step-up mail')
  return codeOf(mail)
}

/** `verifyStepUp` inside the transaction of an action, which rolls back when it throws (DOC-26 §4.5). */
const verify = (
  admin: Admin,
  proof: { password?: string; code: string },
  action: StepUpAction = 'gateway_config',
) =>
  h.database.run(() =>
    h.identity.api.verifyStepUp(admin.context, action, {
      password: proof.password ?? PASSWORD,
      code: proof.code,
    }),
  )

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a failure')
}

const noticeCount = async () =>
  (await h.outboxOf('identity.mail_requested.v1')).filter(
    (r) => r.payload.kind === 'step_up_notice',
  ).length

const wrongCodeOf = (code: string) => (code === '000000' ? '000001' : '000000')

const liveToken = async (admin: Admin, action: StepUpAction = 'gateway_config') =>
  (
    await h.db.sql`
      SELECT attempts, consumed_at FROM identity.password_token
       WHERE staff_id = ${admin.id} AND kind = 'step_up' AND action = ${action} AND consumed_at IS NULL`
  )[0]

describe('step-up (DOC-26 §4.5)', () => {
  test('AU-43: the code has 6 digits, lives 10 minutes, works once, and a second request consumes the first', async () => {
    const admin = await seedAdmin()
    const code = await requestCode(admin)
    expect(code).toMatch(/^\d{6}$/)
    await verify(admin, { code })
    expect(await liveToken(admin)).toBeUndefined()
    expect(await failure(verify(admin, { code }))).toMatchObject({ code: 'step_up_failed' })

    const late = await requestCode(admin)
    h.clock.advance(9 * MINUTE + 59_000)
    await verify(admin, { code: late })

    const expired = await requestCode(admin)
    h.clock.advance(10 * MINUTE + 1000)
    expect(await failure(verify(admin, { code: expired }))).toMatchObject({
      code: 'step_up_failed',
    })

    const first = await requestCode(admin)
    const second = await requestCode(admin)
    if (first !== second)
      expect(await failure(verify(admin, { code: first }))).toMatchObject({
        code: 'step_up_failed',
      })
    await verify(admin, { code: second })
  })

  test("AU-44: a wrong code, a wrong password and another Admin's code are the same 403; the notice exists only after success", async () => {
    const admin = await seedAdmin()
    const other = await seedAdmin()
    const code = await requestCode(admin)
    const otherCode = await requestCode(other)
    const noticesBefore = await noticeCount()

    for (const proof of [
      { code: wrongCodeOf(code) },
      { code, password: 'Wrong-password1' },
      { code: otherCode === code ? wrongCodeOf(code) : otherCode },
    ]) {
      const error = await failure(verify(admin, proof))
      expect(error).toMatchObject({ code: 'step_up_failed' })
      expect(error).toHaveProperty('details.attemptsLeft')
    }
    expect(await noticeCount()).toBe(noticesBefore)
  })

  test('AU-45: a code requested for staff_email does not open gateway_config', async () => {
    const admin = await seedAdmin()
    const code = await requestCode(admin, 'staff_email')
    expect(await failure(verify(admin, { code }, 'gateway_config'))).toMatchObject({
      code: 'step_up_failed',
    })
    await verify(admin, { code }, 'staff_email')
  })

  test('AU-46: five wrong codes consume the challenge, the counts survive the rollback, and the right code then fails with attemptsLeft 0', async () => {
    const admin = await seedAdmin()
    const code = await requestCode(admin)
    const wrong = wrongCodeOf(code)
    for (let tries = 1; tries <= 5; tries++) {
      expect(await failure(verify(admin, { code: wrong }))).toMatchObject({
        code: 'step_up_failed',
        details: { attemptsLeft: 5 - tries },
      })
    }
    const rows = await h.db.sql`
      SELECT attempts, consumed_at FROM identity.password_token WHERE staff_id = ${admin.id} AND kind = 'step_up'`
    expect(rows[0]?.attempts).toBe(5)
    expect(rows[0]?.consumed_at).not.toBeNull()
    expect(await failure(verify(admin, { code }))).toMatchObject({
      code: 'step_up_failed',
      details: { attemptsLeft: 0 },
    })
  })

  test('AU-46b: parallel wrong codes are each counted, the fifth consumes the challenge, and later ones count nothing', async () => {
    const admin = await seedAdmin()
    const code = await requestCode(admin)
    const wrong = wrongCodeOf(code)
    const round = (size: number) =>
      Promise.allSettled(Array.from({ length: size }, () => verify(admin, { code: wrong })))
    for (const result of [...(await round(4)), ...(await round(3))])
      expect(result.status === 'rejected' && result.reason).toMatchObject({
        code: 'step_up_failed',
      })
    const rows = await h.db.sql`
      SELECT attempts, consumed_at FROM identity.password_token WHERE staff_id = ${admin.id} AND kind = 'step_up'`
    expect(rows[0]?.attempts).toBe(5)
    expect(rows[0]?.consumed_at).not.toBeNull()
  })

  test('AU-43b: the right code twice in parallel opens one action', async () => {
    const admin = await seedAdmin()
    const code = await requestCode(admin)
    const results = await Promise.allSettled([verify(admin, { code }), verify(admin, { code })])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })

  test('AU-47: a wrong password counts toward the sign-in lock, not toward the code; five lock sign-in', async () => {
    const admin = await seedAdmin()
    const code = await requestCode(admin)
    for (let tries = 1; tries <= 5; tries++) {
      expect(await failure(verify(admin, { code, password: 'Wrong-password1' }))).toMatchObject({
        code: 'step_up_failed',
      })
      expect((await h.row(admin.id))?.failed_attempts).toBe(Math.min(tries, 5))
    }
    expect((await liveToken(admin))?.attempts).toBe(0)
    await expect(h.signIn(admin.email, PASSWORD, { ip: '198.51.100.9' })).rejects.toMatchObject({
      code: 'account_locked',
    })
  })

  test('AU-48: a successful proof queues one notice per active Admin, the actor included', async () => {
    const admin = await seedAdmin()
    const second = await seedAdmin()
    await h.seedStaff({ role: 'admin', status: 'disabled' })
    await h.seedStaff({ role: 'manager' })
    const code = await requestCode(admin)
    const before = (await h.outboxOf('identity.mail_requested.v1')).length
    await verify(admin, { code })
    const notices = (await h.outboxOf('identity.mail_requested.v1'))
      .slice(before)
      .filter((r) => r.payload.kind === 'step_up_notice')
    const recipients = notices.map((r) => r.payload.staffId ?? r.aggregate_id)
    expect(recipients).toEqual(expect.arrayContaining([admin.id, second.id]))
    expect(JSON.stringify(notices)).not.toContain(code)
  })

  test('AU-49: a success followed by a failure of the action rolls back: the code is live and no notice exists', async () => {
    const admin = await seedAdmin()
    const code = await requestCode(admin)
    const before = (await h.outboxOf('identity.mail_requested.v1')).length
    await expect(
      h.database.run(async () => {
        await h.identity.api.verifyStepUp(admin.context, 'gateway_config', {
          password: PASSWORD,
          code,
        })
        throw new Error('gateway_in_use')
      }),
    ).rejects.toThrow('gateway_in_use')
    expect((await liveToken(admin))?.consumed_at).toBeNull()
    expect(await h.outboxOf('identity.mail_requested.v1')).toHaveLength(before)
    await verify(admin, { code })
  })

  test('AU-50: the sixth request in an hour is 429', async () => {
    const admin = await seedAdmin()
    for (let n = 0; n < 5; n++)
      await h.identity.useCases.requestStepUp.execute(admin.context, 'admin_change')
    expect(
      await failure(h.identity.useCases.requestStepUp.execute(admin.context, 'admin_change')),
    ).toBeInstanceOf(RateLimitedError)
  })

  test('a non-Admin is refused before any work', async () => {
    const manager = await h.seedStaff({ role: 'manager' })
    expect(
      await failure(h.identity.useCases.requestStepUp.execute(manager.context, 'gateway_config')),
    ).toMatchObject({ code: 'forbidden' })
  })
})
