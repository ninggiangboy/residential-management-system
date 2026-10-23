import { NotFoundError } from '@core/kernel'
import type { ResidentSession } from '@rms/shared-types'
import type { DeletionRequestDto, ResidentAccountDto, ResidentPhoneMatch } from '../../contracts'
import { UnauthenticatedError } from '../../domain/errors'
import { ResidentAccount, type ResidentAccountRecord } from '../../domain/resident-account'
import type { ResidentAccountRepository } from '../../domain/resident-account-repository'
import type { ActiveMembership, ActiveMemberships } from '../ports'
import { type ResidentProfile, toResidentProfile } from '../use-cases/verify-otp'

const MAX_IDS = 500
const MAX_PHONES = 5000
const MAX_FRAGMENT_HITS = 500
const DEFAULT_PAGE = 100
const MAX_PAGE = 500

const toDto = (record: ResidentAccountRecord): ResidentAccountDto => ({
  accountId: record.id,
  phone: record.phone,
  displayName: record.displayName,
  language: record.language,
  pushEnabled: record.pushEnabled,
  status: record.status,
  lastAppOpenAt: record.lastAppOpenAt?.toISOString() ?? null,
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

  /** The `db` layer of the units-and-owners import (DOC-18 §1.5): one query for the whole file. */
  async findByPhones(phones: readonly string[]): Promise<ResidentPhoneMatch[]> {
    if (phones.length > MAX_PHONES)
      throw new RangeError(`findResidentAccountsByPhones takes at most ${MAX_PHONES} numbers`)
    return (await this.residents.findByPhones(phones)).flatMap((record) =>
      record.status === 'deleted'
        ? []
        : [
            {
              phone: record.phone,
              accountId: record.id,
              displayName: record.displayName,
              status: record.status,
            },
          ],
    )
  }

  /** The phone search of DOC-27 §11.1: digits only, 4 to 15 (the caller applies FR-18.5), at most 500 accounts. */
  async findByPhoneFragment(fragment: string, limit: number): Promise<ResidentAccountDto[]> {
    if (!/^[0-9]{4,15}$/.test(fragment)) throw new RangeError('the fragment is 4 to 15 digits')
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FRAGMENT_HITS)
      throw new RangeError(`limit is 1 to ${MAX_FRAGMENT_HITS}`)
    return (await this.residents.findByPhoneSuffix(fragment, limit)).map(toDto)
  }

  /** The pending deletions, oldest first (DOC-35 §10.2). */
  async listDeletionRequests(
    page: { after?: string; limit?: number } = {},
  ): Promise<{ items: DeletionRequestDto[]; next: string | null }> {
    const limit = Math.min(page.limit ?? DEFAULT_PAGE, MAX_PAGE)
    const rows = await this.residents.listDeletionRequests(page.after, limit + 1)
    const items = rows.slice(0, limit).map((row) => ({
      accountId: row.accountId,
      requestedAt: row.requestedAt.toISOString(),
      approvedAt: row.approvedAt?.toISOString() ?? null,
    }))
    return { items, next: rows.length > limit ? (items.at(-1)?.accountId ?? null) : null }
  }
}
