import { type Clock, NotFoundError } from '@core/kernel'
import { PhoneInUseError, PhoneInvalidError } from '../../domain/errors'
import { ResidentAccount } from '../../domain/resident-account'
import type { ResidentAccountRepository } from '../../domain/resident-account-repository'
import type { SessionRepository } from '../../domain/session-repository'
import type { PhoneNumbers } from '../ports'
import type { SessionEvents } from '../session-events'
import { isUniqueViolation } from '../unique-violation'

/**
 * `IdentityApi.changeResidentPhone` (DOC-26 §2.2, DOC-27 §8): one guarded `UPDATE` of the phone, then every refresh family of
 * the account ends with `phone_changed` and tells `realtime` and `notification` (§3.8). It joins the caller's transaction and
 * opens none: `residency` audits the change and answers the Manager. An unknown or deleted account looks missing; the same number
 * changes nothing; a number with an account is `phone_in_use`, decided by the unique index when two changes race.
 */
export class ChangeResidentPhone {
  constructor(
    private readonly phones: PhoneNumbers,
    private readonly residents: ResidentAccountRepository,
    private readonly sessions: SessionRepository,
    private readonly events: SessionEvents,
    private readonly clock: Clock,
  ) {}

  async execute(accountId: string, newPhone: string): Promise<void> {
    const { phones, residents, sessions, events, clock } = this
    const phone = phones.toE164(newPhone)
    if (phone === null) throw new PhoneInvalidError()
    const record = await residents.findById(accountId)
    if (!record) throw new NotFoundError()
    const transition = new ResidentAccount(record).changePhone(phone)
    if (!transition) return
    const now = clock.now()
    try {
      // `false`: the account moved (deleted, or another change) since it was read; it no longer looks like this one.
      if (!(await residents.apply(transition, now))) throw new NotFoundError()
    } catch (error) {
      if (isUniqueViolation(error)) throw new PhoneInUseError()
      throw error
    }
    const revoked = await sessions.revokeAllOf('resident', accountId, 'phone_changed', now)
    await events.revoked(revoked, 'phone_changed', now)
  }
}
