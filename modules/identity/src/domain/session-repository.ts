import type { RevocationReason } from '../contracts'

export type AccountKind = 'staff' | 'resident'
export type Client = 'web' | 'app'

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

/** A family that a statement revoked, with what the `identity.session_revoked.v1` event needs. */
export interface RevokedFamily {
  id: string
  kind: AccountKind
  accountId: string
  buildingId: string | null
}

export interface ConsumedToken {
  familyId: string
  kind: AccountKind
  accountId: string
  buildingId: string | null
  client: Client
  absoluteExpiresAt: Date
}

/** Why a presented refresh token was not the first use of a live token (DOC-26 §3.5 step 3). */
export type TokenFate =
  | { fate: 'unknown' }
  | { fate: 'dead' }
  | { fate: 'grace'; family: ConsumedToken }
  | { fate: 'reuse'; family: RevokedFamily }

export interface SessionRow {
  id: string
  client: Client
  userAgent: string | null
  createdAt: Date
  lastUsedAt: Date
}

/** Refresh families and their tokens (DOC-16 §4.5): one family is one sign-in on one device, the session `sid`. */
export interface SessionRepository {
  insertFamily(family: NewFamily, now: Date): Promise<void>
  insertToken(token: NewToken, now: Date): Promise<void>
  /** Revokes the oldest live families so that `keep` stay; the cap statement of DOC-16 §4.5. */
  evictOldest(
    kind: AccountKind,
    accountId: string,
    keep: number,
    now: Date,
  ): Promise<RevokedFamily[]>
  /** The rotation `UPDATE`: a row means this request is the first user of the token (DOC-16 §4.5). */
  consume(tokenHash: string, nextId: string, now: Date): Promise<ConsumedToken | null>
  /** Forgets the successor a consume named, when the rotation ends without issuing one (the account is no longer active). */
  dropSuccessor(tokenHash: string): Promise<void>
  /** The classification `SELECT` of a token that was not consumed. Revokes the family on reuse and returns it. */
  classify(tokenHash: string, now: Date, graceSeconds: number): Promise<TokenFate>
  touchFamily(familyId: string, now: Date): Promise<void>
  /** Revokes one live family and its live tokens; `null` when there is none (a repeat, or another account's). */
  revokeFamily(familyId: string, reason: RevocationReason, now: Date): Promise<RevokedFamily | null>
  /** The same, only if the family belongs to the account: a foreign session looks missing (UC-26 E3). */
  revokeOwned(
    kind: AccountKind,
    accountId: string,
    familyId: string,
    reason: RevocationReason,
    now: Date,
  ): Promise<RevokedFamily | null>
  revokeAllOf(
    kind: AccountKind,
    accountId: string,
    reason: RevocationReason,
    now: Date,
  ): Promise<RevokedFamily[]>
  /** The family a presented refresh token belongs to, for a logout (any state). */
  familyOfToken(tokenHash: string): Promise<{ id: string } | null>
  listLive(kind: AccountKind, accountId: string, now: Date): Promise<SessionRow[]>
}
