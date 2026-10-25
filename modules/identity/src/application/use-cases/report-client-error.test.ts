import { describe, expect, test } from 'bun:test'
import { RateLimitedError } from '@core/kernel'
import type { RateLimiter, RateRule } from '../ports'
import { maskPhones, ReportClientError } from './report-client-error'

describe('maskPhones', () => {
  test('ER-43 a phone with a country code keeps the code and the last three digits', () => {
    expect(maskPhones('No account for +84901234567')).toBe('No account for +84•••••567')
    expect(maskPhones('call +84 901 234 567 now')).toBe('call +84•••••567 now')
  })

  test('ER-43 a national number keeps the last three digits', () => {
    expect(maskPhones('phone=0901234567.')).toBe('phone=•••••567.')
    expect(maskPhones('0901 234 567')).toBe('•••••567')
  })

  test('ids, versions, line numbers and short numbers are left alone', () => {
    const text =
      'at FeeRow (main.js:1204:17) v1.0.3 id 0192f3c4-9d02-7000-8000-00000000f001 total 1234567'
    expect(maskPhones(text)).toBe(text)
  })
})

describe('ReportClientError', () => {
  const report = {
    app: 'web' as const,
    appVersion: '1.0.3',
    platform: 'web' as const,
    kind: 'crash' as const,
    screen: null,
    errorName: 'Error',
    message: 'boom',
    stack: null,
    requestId: null,
  }
  const setup = (refuse?: 'ip' | 'account') => {
    const taken: RateRule[] = []
    const limiter = (family: 'ip' | 'account'): RateLimiter => ({
      take: async (rule) => {
        taken.push(rule)
        if (refuse === family) throw new RateLimitedError('client_errors', 5)
      },
    })
    const lines: Array<Record<string, unknown>> = []
    const logger = { warn: (fields: Record<string, unknown>) => lines.push(fields) }
    const useCase = new ReportClientError(limiter('ip'), limiter('account'), logger as never, {
      clientErrorsPerMinutePerIp: 10,
      clientErrorsPerHourPerAccount: 30,
    })
    return { useCase, taken, lines }
  }

  test('spends a token of the IP bucket, and of the account bucket when a token named one, then logs once', async () => {
    const { useCase, taken, lines } = setup()
    await useCase.execute({ report, ip: '203.0.113.5', account: null })
    expect(taken).toEqual([{ key: 'client_errors:ip:203.0.113.5', capacity: 10, perSeconds: 60 }])
    await useCase.execute({ report, ip: '203.0.113.5', account: { kind: 'staff', id: 'abc' } })
    expect(taken.at(-1)).toEqual({
      key: 'client_errors:account:abc',
      capacity: 30,
      perSeconds: 3600,
    })
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatchObject({
      event: 'client_error',
      accountKind: 'staff',
      accountId: 'abc',
    })
  })

  test('a refusal logs nothing', async () => {
    for (const refuse of ['ip', 'account'] as const) {
      const { useCase, lines } = setup(refuse)
      await expect(
        useCase.execute({ report, ip: '203.0.113.5', account: { kind: 'resident', id: 'abc' } }),
      ).rejects.toBeInstanceOf(RateLimitedError)
      expect(lines).toHaveLength(0)
    }
  })
})
