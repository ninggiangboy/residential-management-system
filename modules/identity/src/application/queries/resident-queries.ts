import { NotFoundError } from '@core/kernel'
import type { ResidentSession } from '@rms/shared-types'
import type { ResidentAccountDto } from '../../contracts'
import { UnauthenticatedError } from '../../domain/errors'
import { ResidentAccount, type ResidentAccountRecord } from '../../domain/resident-account'
import type { ResidentAccountRepository } from '../../domain/resident-account-repository'
import type { ActiveMembership, ActiveMemberships } from '../ports'
import { type ResidentProfile, toResidentProfile } from '../use-cases/verify-otp'

const MAX_IDS = 500

const toDto = (record: ResidentAccountRecord): ResidentAccountDto => ({
  accountId: record.id,
  phone: record.phone,
  displayName: record.displayName,
  language: record.language,
  pushEnabled: record.pushEnabled,
  status: record.status,
})

/** The reads of resident accounts: `GET /me` and the call of `IdentityApi` (DOC-09 §7.3). */
export class ResidentQueries {
  constructor(
    private readonly residents: ResidentAccountRepository,
    private readonly memberships: ActiveMemberships,
  ) {}

  /** The account and its active memberships, as the sign-in answers them (DOC-26 §3.4). The terms gate exempts it (DOC-35 §9.2). */
  async me(
    resident: ResidentSession,
  ): Promise<{ account: ResidentProfile; memberships: ActiveMembership[] }> {
    const [record] = await this.residents.findByIds([resident.accountId])
    if (!record) throw new NotFoundError()
    // An access token outlives the deletion of its account by up to 15 minutes (DOC-26 §3.1); the profile of a deleted one is gone.
    if (!new ResidentAccount(record).canSignIn) throw new UnauthenticatedError()
    return {
      account: toResidentProfile(record),
      memberships: await this.memberships.listActive(record.id),
    }
  }

  listDemoAccountIds(): Promise<string[]> {
    return this.residents.demoAccountIds()
  }

  async getResidentAccounts(ids: readonly string[]): Promise<ResidentAccountDto[]> {
    if (ids.length > MAX_IDS)
      throw new RangeError(`getResidentAccounts takes at most ${MAX_IDS} ids`)
    return (await this.residents.findByIds(ids)).map(toDto)
  }
}
