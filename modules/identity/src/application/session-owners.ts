import type { AccessClaims, RevocationReason } from '../contracts'
import type { RefreshFamily } from '../domain/refresh-family'
import { ResidentAccount } from '../domain/resident-account'
import type { ResidentAccountRepository } from '../domain/resident-account-repository'
import type { SessionRepository } from '../domain/session-repository'
import type { StaffAccountRepository } from '../domain/staff-account-repository'
import type { IdentityConfig } from './config'
import type { SessionEvents } from './session-events'
import { residentClaims, staffClaims } from './session-issuer'

/** The account of a family that may keep refreshing, and what a new token for it carries. */
export interface ActiveOwner {
  claims: AccessClaims
  /** The sliding lifetime of the next refresh token (DOC-26 §3.6). */
  slidingDays: number
  /** Work that follows a refresh of this kind of account: a resident's `last_app_open_at` (DOC-26 §5.2). */
  afterRefresh(now: Date): Promise<void>
}

/**
 * Decides whether the account behind a family may still have a session (DOC-26 §3.5 step 5, DR-130): a staff family needs an
 * `active` account (a temporary lockout does not stop a refresh), a resident family needs `active` or `deletion_requested`. An
 * account that may not ends the family with the matching reason and tells `realtime` and `notification`; `null` then.
 */
export class SessionOwners {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly staffAccounts: StaffAccountRepository,
    private readonly residents: ResidentAccountRepository,
    private readonly events: SessionEvents,
    private readonly config: IdentityConfig,
  ) {}

  async active(family: RefreshFamily, now: Date): Promise<ActiveOwner | null> {
    const { kind, accountId } = family.record
    if (kind === 'staff') {
      const staff = await this.staffAccounts.findById(accountId)
      if (staff?.status === 'active')
        return {
          claims: staffClaims(staff, family.id),
          slidingDays: this.config.refreshTtlDaysStaff,
          afterRefresh: async () => {},
        }
      return this.end(
        family,
        staff?.status === 'locked' ? 'account_locked' : 'account_disabled',
        now,
      )
    }
    const record = (await this.residents.findByIds([accountId]))[0]
    const account = record ? new ResidentAccount(record) : null
    if (record && account?.canSignIn)
      return {
        claims: residentClaims(record, family.id),
        slidingDays: this.config.refreshTtlDaysResident,
        // Written at most once an hour; a lost race means another refresh stamped it, which is as good (AU-54).
        afterRefresh: async (at) => {
          const opened = account.appOpened(at)
          if (opened) await this.residents.apply(opened, at)
        },
      }
    return this.end(family, 'deleted', now)
  }

  private async end(family: RefreshFamily, reason: RevocationReason, now: Date): Promise<null> {
    const revocation = family.revoke(reason, now)
    if (revocation && (await this.sessions.revokeFamily(revocation, now)))
      await this.events.revoked([family.summary], reason, now)
    return null
  }
}
