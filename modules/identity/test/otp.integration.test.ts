import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { smsAad } from '../src/application/sms-commands'
import { DrizzleOtpChallengeRepository } from '../src/infrastructure/persistence/drizzle-otp-challenge-repository'
import { createHarness, type Harness, otpOf } from './support'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

let ipCounter = 0
const nextIp = () => `198.51.100.${++ipCounter}`

/** A registered resident with a code requested and delivered: the challenge and the code the SMS carried. */
async function withCode(options: { isDemo?: boolean } = {}) {
  const resident = await h.seedResident({ isDemo: options.isDemo })
  const requested = await h.requestOtp(resident.phone, nextIp())
  const sms = (await h.deliverSms()).find((message) => message.to === resident.phone)
  return { resident, requested, code: sms ? otpOf(sms) : null }
}

/** Time passes for the application clock and for the database clock that the rate buckets read. */
async function elapse(milliseconds: number) {
  h.clock.advance(milliseconds)
  await h.admin`UPDATE identity.rate_bucket SET updated_at = updated_at - ${milliseconds} * interval '1 millisecond'`
}

const challengeOf = async (id: string) =>
  (
    await h.db
      .sql`SELECT attempts, consumed_at, expires_at, resend_after FROM identity.otp_challenge WHERE id = ${id}`
  )[0]
const smsCommands = () => h.outboxOf('identity.sms_requested.v1')
const familiesOf = async (accountId: string) =>
  h.db.sql`SELECT id FROM identity.refresh_family WHERE account_id = ${accountId}`

describe('request (DOC-26 §5.1)', () => {
  test('AU-20: a registered phone gets a challenge and one SMS command; an unregistered one gets 404 and none', async () => {
    const resident = await h.seedResident()
    const before = (await smsCommands()).length
    const requested = await h.requestOtp(resident.phone, nextIp())
    expect(requested).toMatchObject({ resendAfter: 45, expiresIn: 300 })
    expect(await smsCommands()).toHaveLength(before + 1)

    await expect(h.requestOtp('+84909999999', nextIp())).rejects.toMatchObject({
      code: 'phone_not_registered',
      kind: 'not_found',
    })
    expect(await smsCommands()).toHaveLength(before + 1)
  })

  test('a number that is valid nowhere is 400 phone_invalid, and a national format is accepted', async () => {
    await expect(h.requestOtp('0123456789', nextIp())).rejects.toMatchObject({
      code: 'validation_failed',
      details: [{ code: 'phone_invalid' }],
    })
    const resident = await h.seedResident({ phone: '+84902222222' })
    await h.requestOtp('0902222222', nextIp())
    const [challenge] = await h.db
      .sql`SELECT phone FROM identity.otp_challenge WHERE phone = ${resident.phone}`
    expect(challenge?.phone).toBe('+84902222222')
  })

  test('a deleted account has no phone to ask for a code, and one that requested deletion still signs in', async () => {
    const deleting = await h.seedResident({ status: 'deletion_requested' })
    await h.requestOtp(deleting.phone, nextIp())
    const gone = await h.seedResident({ status: 'deleted', phone: `deleted:${h.ids.next()}` })
    await expect(h.requestOtp(gone.phone, nextIp())).rejects.toMatchObject({
      code: 'validation_failed',
    })
  })

  test('AU-21: a verify at 4 min 59 s works and one at 5 min 01 s does not; resend at 30 s is 429, at 46 s works', async () => {
    const a = await withCode()
    h.clock.advance(299_000)
    await h.verifyOtp(a.requested.challengeId, a.code as string)

    const b = await withCode()
    h.clock.advance(301_000)
    await expect(h.verifyOtp(b.requested.challengeId, b.code as string)).rejects.toMatchObject({
      code: 'otp_invalid',
      details: { attemptsLeft: 0 },
    })

    const resident = await h.seedResident()
    const first = await h.requestOtp(resident.phone, nextIp())
    h.clock.advance(30_000)
    await expect(h.requestOtp(resident.phone, nextIp())).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterSeconds: 15,
    })
    h.clock.advance(16_000)
    const second = await h.requestOtp(resident.phone, nextIp())
    expect((await challengeOf(first.challengeId))?.consumed_at).not.toBeNull()
    expect((await challengeOf(second.challengeId))?.consumed_at).toBeNull()
  })

  test('two requests for one phone at the same moment leave one live challenge and one of them waits', async () => {
    const resident = await h.seedResident()
    const results = await Promise.allSettled([
      h.requestOtp(resident.phone, nextIp()),
      h.requestOtp(resident.phone, nextIp()),
      h.requestOtp(resident.phone, nextIp()),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results.filter((r) => r.status === 'rejected'))
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'rate_limited' })
    const [live] = await h.db
      .sql`SELECT count(*)::int AS n FROM identity.otp_challenge WHERE phone = ${resident.phone} AND consumed_at IS NULL`
    expect(live?.n).toBe(1)
  })

  test('AU-24: 50 requests for one phone 46 s apart leave at most 5 at once, then one per 12 minutes, and never 10 in an hour', async () => {
    const resident = await h.seedResident()
    let issued = 0
    const issuedAt: number[] = []
    for (let i = 0; i < 50; i++) {
      try {
        await h.requestOtp(resident.phone, nextIp())
        issued++
        issuedAt.push(h.clock.now().getTime())
      } catch (error) {
        expect(error).toMatchObject({ code: 'rate_limited' })
      }
      await elapse(46_000)
    }
    // 5 at once, then one per 12 minutes over 50 x 46 s = 38.3 minutes
    expect(issued).toBe(8)
    for (const start of issuedAt)
      expect(
        issuedAt.filter((t) => t >= start && t < start + 3_600_000).length,
      ).toBeLessThanOrEqual(10)
  })

  test('AU-24: 200 phones from one IP: the 21st request is 429, registered or not', async () => {
    const ip = nextIp()
    const results: string[] = []
    for (let i = 0; i < 22; i++) {
      const resident =
        i % 2 === 0 ? await h.seedResident() : { phone: `+8493${String(i).padStart(7, '0')}` }
      try {
        await h.requestOtp(resident.phone, ip)
        results.push('ok')
      } catch (error) {
        results.push((error as { code: string }).code)
      }
    }
    // The first 20 spend the IP bucket (an unregistered phone spends one too); the 21st and 22nd are refused.
    expect(results.slice(0, 20)).not.toContain('rate_limited')
    expect(results.slice(20)).toEqual(['rate_limited', 'rate_limited'])
  })

  test('AU-25: the 3,001st challenge in 24 hours is 503, and a challenge 24 h 1 min old is not counted', async () => {
    const capped = await createHarness({ config: { otpDailyCap: 3 } })
    try {
      const old = await capped.seedResident()
      await capped.requestOtp(old.phone, '198.51.100.250')
      capped.clock.advance(24 * 3_600_000 + 60_000)
      for (let i = 0; i < 3; i++) {
        const resident = await capped.seedResident()
        await capped.requestOtp(resident.phone, `198.51.100.${200 + i}`)
      }
      const last = await capped.seedResident()
      await expect(capped.requestOtp(last.phone, '198.51.100.230')).rejects.toMatchObject({
        code: 'sms_unavailable',
        retryAfterSeconds: 60,
      })
    } finally {
      await capped.close()
    }
  })

  test('AU-29: three failing commands in 10 minutes and none delivered make the request 503; one delivered clears it', async () => {
    const down = await createHarness()
    try {
      const resident = await down.seedResident()
      const other = await down.seedResident()
      // Three commands the relay tried and failed to send.
      for (let i = 0; i < 3; i++)
        await down.admin`
          INSERT INTO identity.outbox_messages (id, type, aggregate_id, payload, headers, occurred_at, last_error)
          VALUES (${down.ids.next()}, 'identity.sms_requested.v1', ${down.ids.next()}, '{}', '{}', ${down.clock.now()}, 'provider down')`
      await expect(down.requestOtp(resident.phone, '198.51.100.240')).rejects.toMatchObject({
        code: 'sms_unavailable',
        retryAfterSeconds: 60,
      })
      // A delivered command: not down. The answer is cached 15 seconds, so wait them out.
      await down.admin`
        INSERT INTO identity.outbox_messages (id, type, aggregate_id, payload, headers, occurred_at, published_at)
        VALUES (${down.ids.next()}, 'identity.sms_requested.v1', ${down.ids.next()}, '{}', '{}', ${down.clock.now()}, ${down.clock.now()})`
      down.clock.advance(16_000)
      await down.requestOtp(other.phone, '198.51.100.241')
    } finally {
      await down.close()
    }
  })
})

describe('verify (DOC-26 §5.2)', () => {
  test('a right code signs in: tokens, account, memberships; the code is consumed', async () => {
    const { resident, requested, code } = await withCode()
    h.memberships.set(resident.id, [
      {
        membershipId: h.ids.next(),
        unitId: h.ids.next(),
        unitCode: 'A-1508',
        memberType: 'owner',
        canPay: true,
      },
    ])
    const signedIn = await h.verifyOtp(requested.challengeId, code as string)
    expect(signedIn.session.refreshToken).toBeTruthy()
    expect(signedIn.account).toMatchObject({
      id: resident.id,
      phone: resident.phone,
      language: 'vi',
    })
    expect(signedIn.memberships).toHaveLength(1)
    const claims = await h.identity.verifier.verify(signedIn.session.accessToken)
    expect(claims).toMatchObject({ kind: 'resident', sub: resident.id })
    expect(claims).not.toHaveProperty('bid')
    expect((await challengeOf(requested.challengeId))?.consumed_at).not.toBeNull()
    const [family] = await h.db
      .sql`SELECT kind, client, building_id, absolute_expires_at, created_at FROM identity.refresh_family WHERE account_id = ${resident.id}`
    expect(family).toMatchObject({ kind: 'resident', client: 'app', building_id: null })
    const days =
      (new Date(family?.absolute_expires_at).getTime() - new Date(family?.created_at).getTime()) /
      86_400_000
    expect(days).toBe(365)
  })

  test('an account with no unit still signs in with an empty list (UC-14 E7)', async () => {
    const { requested, code } = await withCode()
    const signedIn = await h.verifyOtp(requested.challengeId, code as string)
    expect(signedIn.memberships).toEqual([])
  })

  test('AU-22: five wrong codes answer 4, 3, 2, 1, 0 tries left, and the right code afterwards is refused too', async () => {
    const { requested, code } = await withCode()
    const wrong = code === '000000' ? '111111' : '000000'
    const left: number[] = []
    for (let i = 0; i < 5; i++) {
      try {
        await h.verifyOtp(requested.challengeId, wrong)
      } catch (error) {
        expect(error).toMatchObject({ code: 'otp_invalid', kind: 'validation' })
        left.push((error as { details: { attemptsLeft: number } }).details.attemptsLeft)
      }
    }
    expect(left).toEqual([4, 3, 2, 1, 0])
    await expect(h.verifyOtp(requested.challengeId, code as string)).rejects.toMatchObject({
      code: 'otp_invalid',
      details: { attemptsLeft: 0 },
    })
    expect((await challengeOf(requested.challengeId))?.attempts).toBe(5)
  })

  test('50 parallel wrong guesses are 5 tries, and the challenge ends', async () => {
    const { requested, code } = await withCode()
    const wrong = code === '000000' ? '111111' : '000000'
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () => h.verifyOtp(requested.challengeId, wrong)),
    )
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    expect((await challengeOf(requested.challengeId))?.attempts).toBe(5)
    await expect(h.verifyOtp(requested.challengeId, code as string)).rejects.toMatchObject({
      code: 'otp_invalid',
    })
  })

  test('AU-23: two verifies of the right code in parallel: one 200 and one family', async () => {
    const { resident, requested, code } = await withCode()
    const results = await Promise.allSettled([
      h.verifyOtp(requested.challengeId, code as string),
      h.verifyOtp(requested.challengeId, code as string),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason,
    ).toMatchObject({
      code: 'otp_invalid',
    })
    expect(await familiesOf(resident.id)).toHaveLength(1)
  })

  test('an unknown challenge id answers like a wrong code with no tries left', async () => {
    await expect(h.verifyOtp(h.ids.next(), '123456')).rejects.toMatchObject({
      code: 'otp_invalid',
      details: { attemptsLeft: 0 },
    })
  })

  test('a code for one challenge does not open another (the HMAC binds the challenge id)', async () => {
    const a = await withCode()
    const b = await withCode()
    await expect(h.verifyOtp(b.requested.challengeId, a.code as string)).rejects.toMatchObject({
      code: 'otp_invalid',
    })
  })

  test('AU-54: opening the app 5 times in 30 minutes writes last_app_open_at once', async () => {
    const { resident, requested, code } = await withCode()
    const first = await h.verifyOtp(requested.challengeId, code as string)
    const stamp = async () =>
      (
        await h.db
          .sql`SELECT last_app_open_at AS at FROM identity.resident_account WHERE id = ${resident.id}`
      )[0]?.at
    const written = await stamp()
    expect(written).not.toBeNull()
    let token = first.session.refreshToken
    for (let i = 0; i < 4; i++) {
      h.clock.advance(6 * 60_000)
      token = (await h.identity.useCases.refreshSession.execute({ refreshToken: token }))
        .refreshToken
    }
    expect(await stamp()).toEqual(written)
    h.clock.advance(40 * 60_000)
    await h.identity.useCases.refreshSession.execute({ refreshToken: token })
    expect(await stamp()).not.toEqual(written)
  })
})

describe('demo accounts (DOC-26 §5.3)', () => {
  test('AU-26: 123456 signs in a flagged demo account with no SMS, and is refused for a real account', async () => {
    const demo = await h.seedResident({ isDemo: true })
    const before = (await smsCommands()).length
    const requested = await h.requestOtp(demo.phone, nextIp())
    expect(await smsCommands()).toHaveLength(before)
    expect(await h.deliverSms()).toEqual([])
    const signedIn = await h.verifyOtp(requested.challengeId, '123456')
    expect(signedIn.account.id).toBe(demo.id)

    const real = await h.seedResident({ isDemo: false })
    const challenge = await h.requestOtp(real.phone, nextIp())
    await expect(h.verifyOtp(challenge.challengeId, '123456')).rejects.toMatchObject({
      code: 'otp_invalid',
      details: { attemptsLeft: 4 },
    })
  })

  test('AU-S04: the demo statement spends a challenge only while its phone belongs to a flagged account', async () => {
    const challenges = new DrizzleOtpChallengeRepository(h.database)
    const spend = (id: string) =>
      challenges.applyDemo({ id, expect: { consumedAt: null }, set: { consumedAt: h.clock.now() } })
    const real = await h.requestOtp((await h.seedResident({ isDemo: false })).phone, nextIp())
    expect(await spend(real.challengeId)).toBe(false)
    expect((await challengeOf(real.challengeId))?.consumed_at).toBeNull()
    const demo = await h.requestOtp((await h.seedResident({ isDemo: true })).phone, nextIp())
    expect(await spend(demo.challengeId)).toBe(true)
  })

  test('a demo account still counts wrong codes', async () => {
    const demo = await h.seedResident({ isDemo: true })
    const requested = await h.requestOtp(demo.phone, nextIp())
    await expect(h.verifyOtp(requested.challengeId, '654321')).rejects.toMatchObject({
      details: { attemptsLeft: 4 },
    })
  })
})

describe('the SMS (DOC-26 §5.4)', () => {
  test('AU-30: the command holds neither the code nor the phone; secretEnc opens to the code', async () => {
    const resident = await h.seedResident()
    await h.requestOtp(resident.phone, nextIp())
    const commands = await smsCommands()
    const payload = commands.at(-1)?.payload
    const text = JSON.stringify(payload)
    expect(text).not.toContain(resident.phone)
    expect(payload).toMatchObject({
      kind: 'otp',
      accountId: resident.id,
      buildingId: null,
      locale: 'vi',
    })
    const sms = (await h.deliverSms()).find((message) => message.to === resident.phone)
    expect(sms).toBeDefined()
    expect(text).not.toContain(otpOf(sms as never))
    expect(sms?.text).toMatch(
      /^\d{6} la ma xac thuc dang nhap SUNRISE\. Co hieu luc 5 phut\. Khong chia se ma nay\.$/,
    )
  })

  test('an English account gets the English text, at most 160 characters', async () => {
    const resident = await h.seedResident({ language: 'en' })
    await h.requestOtp(resident.phone, nextIp())
    const sms = (await h.deliverSms()).find((message) => message.to === resident.phone)
    expect(sms?.text).toMatch(
      /^\d{6} is your SUNRISE login code\. Valid for 5 minutes\. Do not share it\.$/,
    )
    expect(sms?.text.length).toBeLessThanOrEqual(160)
  })

  test('AU-28: a command 6 minutes old sends nothing and is not a failure; a failing provider throws so the outbox retries', async () => {
    const resident = await h.seedResident()
    await h.requestOtp(resident.phone, nextIp())
    h.clock.advance(6 * 60_000)
    expect(await h.deliverSms()).toEqual([])

    const other = await h.seedResident()
    await h.requestOtp(other.phone, nextIp())
    h.provider.fail = true
    try {
      await expect(h.deliverSms()).rejects.toThrow('provider down')
    } finally {
      h.provider.fail = false
    }
    expect(await h.deliverSms()).toHaveLength(1)
  })

  test('a demo account that has a command anyway gets no message (skipped_demo)', async () => {
    const demo = await h.seedResident({ isDemo: true })
    const envelope = {
      id: h.ids.next(),
      type: 'identity.sms_requested.v1',
      source: 'identity',
      aggregateId: h.ids.next(),
      occurredAt: h.clock.now().toISOString(),
      headers: {},
      payload: {
        buildingId: null,
        requestId: h.ids.next(),
        accountId: demo.id,
        kind: 'otp',
        locale: 'vi',
        params: {},
        secretEnc: await h.secretBox.seal(smsAad(demo.id, 'otp'), '482913'),
        expiresAt: new Date(h.clock.now().getTime() + 300_000).toISOString(),
      },
    }
    const [handler] = h.identity.handlers ?? []
    const before = h.texts.length
    for (const candidate of h.identity.handlers ?? [])
      if (candidate.eventType === envelope.type) await candidate.handle(envelope)
    expect(handler).toBeDefined()
    expect(h.texts).toHaveLength(before)
  })
})
