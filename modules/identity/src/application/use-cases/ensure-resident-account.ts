import { type Clock, type IdGenerator, ValidationError } from '@core/kernel'
import type { ResidentAccountRepository } from '../../domain/resident-account-repository'
import type { PhoneNumbers } from '../ports'

/**
 * `IdentityApi.findOrCreateResidentAccount` (DOC-26 §2.2, DOC-27 §9.2 step 4): the account of a phone, created when there is none.
 * It joins the caller's transaction and opens none. The phone is the key, so a second call, or a race, finds the first account and
 * leaves its name alone (DQ-44); a `deletion_requested` account is returned as it is, because it still signs in until the job runs.
 */
export class EnsureResidentAccount {
  constructor(
    private readonly phones: PhoneNumbers,
    private readonly residents: ResidentAccountRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(
    phone: string,
    displayName: string,
  ): Promise<{ accountId: string; created: boolean }> {
    const e164 = this.phones.toE164(phone)
    if (e164 === null)
      throw new ValidationError([
        { path: 'phone', code: 'phone_invalid', message: 'a valid phone number' },
      ])
    const created = await this.residents.insertIfAbsent(
      { id: this.ids.next(), phone: e164, displayName },
      this.clock.now(),
    )
    const [account] = await this.residents.findByPhones([e164])
    // The insert or the earlier row is there; only an account deleted between the two statements would be missing.
    if (!account) throw new Error('resident account vanished during findOrCreateResidentAccount')
    return { accountId: account.id, created }
  }
}
