import type { RevocationReason } from '../contracts'
import type {
  AccountKind,
  Client,
  FamilyRecord,
  FamilyTransition,
  RevokedFamily,
  TokenRecord,
  TokenTransition,
} from './refresh-family'

export interface NewFamily {
  id: string
  kind: AccountKind
  accountId: string
  /** Staff only (DOC-16 §4.5). */
  buildingId: string | null
  userAgent: string | null
  client: Client
  absoluteExpiresAt: Date
}

export interface NewToken {
  id: string
  familyId: string
  tokenHash: string
  expiresAt: Date
}

export interface SessionRow {
  id: string
  client: Client
  userAgent: string | null
  createdAt: Date
  lastUsedAt: Date
}

/** The family and the token a presented refresh token names. */
export interface FoundToken {
  family: FamilyRecord
  token: TokenRecord
}

/**
 * Refresh families and their tokens (DOC-16 §4.5): one family is one sign-in on one device, the session `sid`. The rules live in
 * `RefreshFamily`; a write is an insert, a guarded `apply` of what the aggregate decided (DR-255), or a set-based statement.
 */
export interface SessionRepository {
  insertFamily(family: NewFamily, now: Date): Promise<void>
  insertToken(token: NewToken, now: Date): Promise<void>
  /**
   * Set-based (DR-255 item 5): revokes the oldest live families so that `keep` stay, the cap of DOC-16 §4.5, newest first by
   * `created_at`. The rule is `config.maxFamilies`; no single aggregate decides it.
   */
  evictOldest(
    kind: AccountKind,
    accountId: string,
    keep: number,
    now: Date,
  ): Promise<RevokedFamily[]>
  /** Set-based: every live family of one account, for a password change or a disabled account (DR-129). */
  revokeAllOf(
    kind: AccountKind,
    accountId: string,
    reason: RevocationReason,
    now: Date,
  ): Promise<RevokedFamily[]>
  /** The token a presented refresh token names, with its family, in any state. */
  findByToken(tokenHash: string): Promise<FoundToken | null>
  findFamily(familyId: string): Promise<FamilyRecord | null>
  /**
   * Spends the token the aggregate decided to spend. It matches only while the token is still unspent and its family is still
   * live, so a family revoked in between is not rotated; `false` means another request spent it or the family ended first.
   */
  rotateToken(transition: TokenTransition): Promise<boolean>
  /** Ends the family and its live tokens; `false` when it was revoked first. */
  revokeFamily(transition: FamilyTransition, now: Date): Promise<boolean>
  applyFamily(transition: FamilyTransition): Promise<boolean>
  listLive(kind: AccountKind, accountId: string, now: Date): Promise<SessionRow[]>
  /** The ids among `ids` (any kind, any account) whose family is live: not revoked and not past its absolute limit (DOC-26 §3.7, DR-300). */
  liveIds(ids: readonly string[], now: Date): Promise<string[]>
}
