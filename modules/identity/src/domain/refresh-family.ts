import type { Transition } from '@core/kernel'
import type { RevocationReason } from '../contracts'

export type AccountKind = 'staff' | 'resident'
export type Client = 'web' | 'app'

/** A refresh family, one sign-in on one device, the session `sid` (DOC-16 §4.5). */
export interface FamilyRecord {
  id: string
  kind: AccountKind
  accountId: string
  /** Staff only. */
  buildingId: string | null
  client: Client
  absoluteExpiresAt: Date
  lastUsedAt: Date
  revokedAt: Date | null
  revokedReason: RevocationReason | null
}

/** One refresh token of a family; only its hash is stored. */
export interface TokenRecord {
  id: string
  familyId: string
  expiresAt: Date
  revokedAt: Date | null
  replacedById: string | null
}

export type FamilyTransition = Transition<FamilyRecord>
export type TokenTransition = Transition<TokenRecord>

/** A family that a revocation closed, with what the `identity.session_revoked.v1` event needs. */
export interface RevokedFamily {
  id: string
  kind: AccountKind
  accountId: string
  buildingId: string | null
}

/**
 * What a presented refresh token means (DOC-26 §3.5 step 3): the first use of a live token (`rotate`, with the change that
 * spends it), a second use within the grace window, a second use after it (`reuse`, with the revocation of the family), or a
 * token that is dead (expired, or its family is revoked or past its absolute limit).
 */
export type Presentation =
  | { kind: 'rotate'; transition: TokenTransition }
  | { kind: 'grace' }
  | { kind: 'reuse'; revocation: FamilyTransition }
  | { kind: 'dead' }

/**
 * A refresh family (DOC-26 §3). It decides what a presented token is and when the family ends; the repository applies the change
 * in one guarded statement, so two parallel refreshes of one token spend it once and the loser reads the spent token again as
 * a grace use (DR-255).
 */
export class RefreshFamily {
  constructor(readonly record: FamilyRecord) {}

  get id(): string {
    return this.record.id
  }

  get live(): boolean {
    return this.record.revokedAt === null
  }

  /** The family as the revocation event names it. */
  get summary(): RevokedFamily {
    const { id, kind, accountId, buildingId } = this.record
    return { id, kind, accountId, buildingId }
  }

  ownedBy(kind: AccountKind, accountId: string): boolean {
    return this.record.kind === kind && this.record.accountId === accountId
  }

  /** Classifies a presented token of this family; a rotation names the successor `nextId`. */
  present(token: TokenRecord, now: Date, graceSeconds: number, nextId: string): Presentation {
    const { record } = this
    if (!this.live || token.expiresAt <= now || record.absoluteExpiresAt <= now)
      return { kind: 'dead' }
    if (token.revokedAt === null)
      return {
        kind: 'rotate',
        transition: {
          id: token.id,
          expect: { revokedAt: null },
          set: { revokedAt: now, replacedById: nextId },
        },
      }
    if (now.getTime() - token.revokedAt.getTime() < graceSeconds * 1000) return { kind: 'grace' }
    // Rotated more than the grace window ago and presented again: someone holds a stolen copy.
    return { kind: 'reuse', revocation: this.revoke('token_reuse', now) as FamilyTransition }
  }

  /** The end of the family; the tokens of a revoked family are closed with it. `null` when it was revoked already. */
  revoke(reason: RevocationReason, now: Date): FamilyTransition | null {
    if (!this.live) return null
    return {
      id: this.id,
      expect: { revokedAt: null },
      set: { revokedAt: now, revokedReason: reason },
    }
  }

  /** A refresh keeps the session visibly alive in the list of devices. */
  touched(now: Date): FamilyTransition {
    return { id: this.id, expect: {}, set: { lastUsedAt: now } }
  }
}
