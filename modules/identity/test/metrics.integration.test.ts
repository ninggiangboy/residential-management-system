import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHarness, type Harness, otpOf, PASSWORD } from './support'

/**
 * The counters of DOC-26 §10 (DOC-40 §4.3, P1-18): each use case reports its outcome once, with the labels the document lists. The
 * harness records what the module told `MetricsPort`; the registry behind it is `apps/api`'s.
 */

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

let ip = 0
const nextIp = () => `198.19.1.${++ip}`

describe('staff sign-in and the session', () => {
  test('sign-in outcomes, the lockout once, a refresh, a reuse and the revocations', async () => {
    const staff = await h.seedStaff()
    await h.signIn(staff.email, PASSWORD, { ip: nextIp() })
    expect(h.metrics.count('auth_staff_login_total', { outcome: 'ok' })).toBe(1)

    // Five wrong passwords lock the account: four are `invalid`, the fifth is `locked` and starts the lock; the sixth is refused
    // by the lock itself and starts nothing.
    const locked = await h.seedStaff()
    for (let attempt = 0; attempt < 6; attempt++)
      await h.signIn(locked.email, 'wrong-password-1', { ip: nextIp() }).catch(() => {})
    expect(h.metrics.count('auth_staff_login_total', { outcome: 'invalid' })).toBe(4)
    expect(h.metrics.count('auth_staff_login_total', { outcome: 'locked' })).toBe(2)
    expect(h.metrics.count('auth_lockouts_total')).toBe(1)

    const session = await h.signIn(staff.email, PASSWORD, { ip: nextIp() })
    const next = await h.identity.useCases.refreshSession.execute({
      refreshToken: session.session.refreshToken,
    })
    expect(h.metrics.count('auth_refresh_total', { outcome: 'ok' })).toBe(1)
    h.clock.advance(11_000)
    await h.identity.useCases.refreshSession
      .execute({ refreshToken: session.session.refreshToken })
      .catch(() => {})
    expect(h.metrics.count('auth_refresh_total', { outcome: 'reuse' })).toBe(1)
    expect(h.metrics.count('auth_sessions_revoked_total', { reason: 'token_reuse' })).toBe(1)
    await h.identity.useCases.refreshSession
      .execute({ refreshToken: next.refreshToken })
      .catch(() => {})
    expect(h.metrics.count('auth_refresh_total', { outcome: 'expired' })).toBe(1)
  })
})

describe('the resident OTP', () => {
  test('requested, verified wrong, verified right, and a challenge that is gone', async () => {
    const resident = await h.seedResident()
    const requested = await h.requestOtp(resident.phone, nextIp())
    expect(h.metrics.count('auth_otp_requested_total', { outcome: 'issued' })).toBe(1)

    await h.requestOtp(resident.phone, nextIp()).catch(() => {})
    expect(h.metrics.count('auth_otp_requested_total', { outcome: 'resend_wait' })).toBe(1)
    await h.requestOtp('+84900000000', nextIp()).catch(() => {})
    expect(h.metrics.count('auth_otp_requested_total', { outcome: 'not_registered' })).toBe(1)

    const code = otpOf((await h.deliverSms()).find((sms) => sms.to === resident.phone) as never)
    await h.verifyOtp(requested.challengeId, '000000').catch(() => {})
    expect(h.metrics.count('auth_otp_verify_total', { outcome: 'invalid' })).toBe(1)
    await h.verifyOtp(requested.challengeId, code)
    expect(h.metrics.count('auth_otp_verify_total', { outcome: 'ok' })).toBe(1)
    // The challenge is spent now: it answers like a wrong code to the caller and counts as `expired`.
    await h.verifyOtp(requested.challengeId, code).catch(() => {})
    expect(h.metrics.count('auth_otp_verify_total', { outcome: 'expired' })).toBe(1)
    expect(h.metrics.count('sms_sent_total', { outcome: 'sent' })).toBeGreaterThanOrEqual(1)
  })

  test('the daily cap is counted when it refuses', async () => {
    const capped = await createHarness({ config: { otpDailyCap: 1 } })
    try {
      const first = await capped.seedResident()
      const second = await capped.seedResident()
      await capped.requestOtp(first.phone, nextIp())
      await capped.requestOtp(second.phone, nextIp()).catch(() => {})
      expect(capped.metrics.count('auth_otp_requested_total', { outcome: 'daily_cap' })).toBe(1)
      expect(capped.metrics.count('otp_daily_cap_reached_total')).toBe(1)
      expect(await capped.identity.gauges?.[0]?.read()).toEqual([{ value: 1 }])
    } finally {
      await capped.close()
    }
  })

  test('a provider that fails counts each failed try as `failed`', async () => {
    const resident = await h.seedResident()
    await h.requestOtp(resident.phone, nextIp())
    h.provider.fail = true
    await h.deliverSms().catch(() => {})
    h.provider.fail = false
    expect(h.metrics.count('sms_sent_total', { outcome: 'failed' })).toBe(1)
  })
})

describe('the step-up and the mail', () => {
  test('requested, a wrong proof, and the mail that carried the code', async () => {
    const admin = await h.seedStaff({ role: 'admin' })
    await h.identity.useCases.requestStepUp.execute(admin.context, 'admin_change')
    expect(
      h.metrics.count('auth_step_up_total', { action: 'admin_change', outcome: 'requested' }),
    ).toBe(1)
    expect((await h.deliverMail()).length).toBeGreaterThan(0)
    expect(h.metrics.count('mail_sent_total', { outcome: 'sent' })).toBeGreaterThanOrEqual(1)
    await h.identity.api
      .verifyStepUp(admin.context, 'admin_change', { password: 'wrong-password-1', code: '000000' })
      .catch(() => {})
    expect(
      h.metrics.count('auth_step_up_total', { action: 'admin_change', outcome: 'failed' }),
    ).toBe(1)
  })
})

describe('the gauges the module defines', () => {
  test('otp_challenges_24h counts the challenges of the last day and sms_provider_down is 0 or 1', async () => {
    const [challenges, provider] = h.identity.gauges ?? []
    expect(challenges?.name).toBe('otp_challenges_24h')
    expect((await challenges?.read())?.[0]?.value).toBeGreaterThanOrEqual(1)
    expect(provider?.name).toBe('sms_provider_down')
    expect(await provider?.read()).toEqual([{ value: 0 }])
  })
})
