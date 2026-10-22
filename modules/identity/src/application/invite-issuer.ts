import type { Clock, IdGenerator } from '@core/kernel'
import type { PasswordTokenRepository } from '../domain/password-token-repository'
import type { StaffAccountRecord } from '../domain/staff-account'
import type { IdentityConfig } from './config'
import type { MailCommands } from './mail-commands'
import type { TokenFactory } from './ports'

const HOUR_MS = 3_600_000

export interface InviteIssuerDeps {
  tokens: PasswordTokenRepository
  factory: TokenFactory
  mail: MailCommands
  clock: Clock
  ids: IdGenerator
  config: IdentityConfig
}

/**
 * Issues an invite link and queues its mail: a new link first consumes the older one, so only the last one works (DOC-26 §4.3).
 * The creation of a staff account (P1-14) and the resend of an invite both end here. Runs in the caller's transaction.
 */
export class InviteIssuer {
  constructor(private readonly deps: InviteIssuerDeps) {}

  async issue(staff: Pick<StaffAccountRecord, 'id' | 'buildingId' | 'language'>): Promise<void> {
    const { tokens, factory, mail, clock, ids, config } = this.deps
    const now = clock.now()
    const expiresAt = new Date(now.getTime() + config.inviteTtlHours * HOUR_MS)
    const link = factory.opaque()
    await tokens.issueLink(
      {
        id: ids.next(),
        buildingId: staff.buildingId,
        staffId: staff.id,
        kind: 'invite',
        tokenHash: link.hash,
        expiresAt,
      },
      now,
    )
    await mail.request(staff, 'staff_invite', { secret: link.token, expiresAt })
  }
}
