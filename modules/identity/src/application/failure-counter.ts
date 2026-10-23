import { decide } from '@core/kernel'
import type { FailureOutcome, Lockout } from '../domain/staff-account'
import { StaffAccount } from '../domain/staff-account'
import type { StaffAccountRepository } from '../domain/staff-account-repository'

/**
 * Counts one wrong password of a staff member for the sign-in and for a step-up proof (DOC-26 §4.1, §4.5). Every wrong password
 * must be counted, so a lost race loads the row again and decides on what the winner left (DR-255 item 3): 20 parallel attempts
 * leave 5 failures, and the sixth and later read the lock and count nothing.
 */
export class FailureCounter {
  constructor(private readonly staffAccounts: StaffAccountRepository) {}

  count(staffId: string, lockout: Lockout, now: Date): Promise<FailureOutcome | null> {
    return decide<FailureOutcome | null>(async () => {
      const record = await this.staffAccounts.findById(staffId)
      if (!record) return { done: true, value: null }
      const outcome = new StaffAccount(record).recordFailure(lockout, now)
      if (!outcome.transition) return { done: true, value: outcome }
      return (await this.staffAccounts.apply(outcome.transition, now))
        ? { done: true, value: outcome }
        : { done: false }
    })
  }
}
