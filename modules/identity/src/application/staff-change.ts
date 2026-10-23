import { decide, NotFoundError } from '@core/kernel'
import type { BuildingScope } from '@rms/shared-types'
import {
  StaffAccount,
  type StaffAccountRecord,
  type StaffAccountTransition,
} from '../domain/staff-account'
import type { StaffAccountRepository } from '../domain/staff-account-repository'

/** The row as it was loaded and as the change left it. */
export interface StaffChange {
  before: StaffAccountRecord
  after: StaffAccountRecord
}

/**
 * Load, decide, apply (DR-255) for the changes that carry no `If-Match`: lock, unlock, disable, enable. The aggregate decides on
 * the row it read and one guarded statement applies it; when another actor moved the row in between, it is read again and decided
 * again on what the winner left, which is how a second lock answers `invalid_transition` and not a silent success. An id of
 * another building is 404 (DOC-12 §7). `guard` runs after the rule and before the write (the last-Admin and tickets rules).
 */
export function changeStaffAccount(
  staffAccounts: StaffAccountRepository,
  scope: BuildingScope,
  id: string,
  now: Date,
  rule: (account: StaffAccount) => StaffAccountTransition,
  guard: (account: StaffAccount) => Promise<void> = async () => {},
): Promise<StaffChange> {
  return decide<StaffChange>(async () => {
    const before = await staffAccounts.findScoped(scope, id)
    if (!before) throw new NotFoundError()
    const account = new StaffAccount(before)
    const transition = rule(account)
    await guard(account)
    if (!(await staffAccounts.apply(transition, now))) return { done: false }
    return { done: true, value: { before, after: { ...before, ...transition.set } } }
  })
}
