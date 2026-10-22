import type { Database } from '@core/db'
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import type { RevocationReason } from '../../contracts'
import type {
  AccountKind,
  Client,
  ConsumedToken,
  NewFamily,
  NewToken,
  RevokedFamily,
  SessionRepository,
  SessionRow,
  TokenFate,
} from '../../domain/session-repository'
import { asDate, asDateOrNull } from './dates'
import { refreshFamily, refreshToken } from './schema'

const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`

type FamilyRow = {
  id: string
  kind: AccountKind
  account_id: string
  building_id: string | null
}

const toRevoked = (row: FamilyRow): RevokedFamily => ({
  id: row.id,
  kind: row.kind,
  accountId: row.account_id,
  buildingId: row.building_id,
})

/**
 * The families and tokens of DOC-16 §4.5, with the statements the tests of DOC-26 §13 ran. Every instant is the caller's clock.
 * A refresh token is found by its hash and a family by its id or its owner, so the building is not part of any lookup here.
 */
// scope-ok: a session is found by the hash of its token, by its id, or by its owner; its building is a column of the family
export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly database: Database) {}

  // scope-ok: the family is created for the account that just signed in
  async insertFamily(family: NewFamily, now: Date): Promise<void> {
    // scope-ok: see above
    await this.database.executor.insert(refreshFamily).values({
      id: family.id,
      kind: family.kind,
      accountId: family.accountId,
      buildingId: family.buildingId,
      userAgent: family.userAgent,
      client: family.client,
      createdAt: now,
      lastUsedAt: now,
      absoluteExpiresAt: family.absoluteExpiresAt,
    })
  }

  async insertToken(token: NewToken, now: Date): Promise<void> {
    await this.database.executor.insert(refreshToken).values({
      id: token.id,
      familyId: token.familyId,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
      createdAt: now,
    })
  }

  // scope-ok: the cap is per account
  async evictOldest(
    kind: AccountKind,
    accountId: string,
    keep: number,
    now: Date,
  ): Promise<RevokedFamily[]> {
    // scope-ok: see above
    const rows = await this.database.executor.execute<FamilyRow>(sql`
      UPDATE identity.refresh_family SET revoked_at = ${ts(now)}, revoked_reason = 'cap_exceeded'
       WHERE id IN (SELECT id FROM identity.refresh_family
                     WHERE kind = ${kind} AND account_id = ${accountId}::uuid AND revoked_at IS NULL
                       AND absolute_expires_at > ${ts(now)}
                     ORDER BY created_at DESC OFFSET ${keep}::int)
      RETURNING id, kind, account_id, building_id`)
    const families = rows.map(toRevoked)
    await this.revokeTokensOf(families, now)
    return families
  }

  // scope-ok: the hash is the credential
  async consume(tokenHash: string, nextId: string, now: Date): Promise<ConsumedToken | null> {
    // scope-ok: the hash is the credential
    const rows = await this.database.executor.execute<
      FamilyRow & { family_id: string; client: Client; absolute_expires_at: Date | string }
    >(sql`
      UPDATE identity.refresh_token t SET revoked_at = ${ts(now)}, replaced_by_id = ${nextId}::uuid
        FROM identity.refresh_family f
       WHERE t.token_hash = ${tokenHash} AND t.revoked_at IS NULL AND t.expires_at > ${ts(now)}
         AND f.id = t.family_id AND f.revoked_at IS NULL AND f.absolute_expires_at > ${ts(now)}
      RETURNING t.family_id, f.kind, f.account_id, f.building_id, f.client, f.absolute_expires_at`)
    const [row] = rows
    return row ? this.toConsumed(row) : null
  }

  async dropSuccessor(tokenHash: string): Promise<void> {
    await this.database.executor
      .update(refreshToken)
      .set({ replacedById: null })
      .where(eq(refreshToken.tokenHash, tokenHash))
  }

  // scope-ok: the hash is the credential
  async classify(tokenHash: string, now: Date, graceSeconds: number): Promise<TokenFate> {
    // scope-ok: the hash is the credential
    const rows = await this.database.executor.execute<
      FamilyRow & {
        family_id: string
        client: Client
        absolute_expires_at: Date | string
        token_revoked_at: Date | string | null
        token_expires_at: Date | string
        family_revoked_at: Date | string | null
      }
    >(sql`
      SELECT t.family_id, f.kind, f.account_id, f.building_id, f.client, f.absolute_expires_at,
             t.revoked_at AS token_revoked_at, t.expires_at AS token_expires_at, f.revoked_at AS family_revoked_at
        FROM identity.refresh_token t JOIN identity.refresh_family f ON f.id = t.family_id
       WHERE t.token_hash = ${tokenHash}`)
    const [row] = rows
    if (!row) return { fate: 'unknown' }
    const rotatedAt = asDateOrNull(row.token_revoked_at)
    if (
      row.family_revoked_at !== null ||
      asDate(row.token_expires_at) <= now ||
      asDate(row.absolute_expires_at) <= now ||
      rotatedAt === null
    )
      return { fate: 'dead' }
    const sinceRotation = now.getTime() - rotatedAt.getTime()
    if (sinceRotation < graceSeconds * 1000) return { fate: 'grace', family: this.toConsumed(row) }
    // Rotated more than the grace window ago and presented again: reuse. The family and its tokens are revoked.
    const revoked = await this.revokeFamily(row.family_id, 'token_reuse', now)
    return revoked ? { fate: 'reuse', family: revoked } : { fate: 'dead' }
  }

  // scope-ok: the id is the family the token just proved
  async touchFamily(familyId: string, now: Date): Promise<void> {
    // scope-ok: see above
    await this.database.executor
      .update(refreshFamily)
      .set({ lastUsedAt: now })
      .where(eq(refreshFamily.id, familyId))
  }

  // scope-ok: the id is a family the caller has just proved or listed
  async revokeFamily(
    familyId: string,
    reason: RevocationReason,
    now: Date,
  ): Promise<RevokedFamily | null> {
    // scope-ok: see above
    const rows = await this.database.executor.execute<FamilyRow>(sql`
      UPDATE identity.refresh_family SET revoked_at = ${ts(now)}, revoked_reason = ${reason}
       WHERE id = ${familyId}::uuid AND revoked_at IS NULL
      RETURNING id, kind, account_id, building_id`)
    return this.finishRevocation(rows, now)
  }

  // scope-ok: the account owns the session, which is the scope of the statement
  async revokeOwned(
    kind: AccountKind,
    accountId: string,
    familyId: string,
    reason: RevocationReason,
    now: Date,
  ): Promise<RevokedFamily | null> {
    // scope-ok: see above
    const rows = await this.database.executor.execute<FamilyRow>(sql`
      UPDATE identity.refresh_family SET revoked_at = ${ts(now)}, revoked_reason = ${reason}
       WHERE id = ${familyId}::uuid AND kind = ${kind} AND account_id = ${accountId}::uuid AND revoked_at IS NULL
      RETURNING id, kind, account_id, building_id`)
    return this.finishRevocation(rows, now)
  }

  // scope-ok: every session of one account
  async revokeAllOf(
    kind: AccountKind,
    accountId: string,
    reason: RevocationReason,
    now: Date,
  ): Promise<RevokedFamily[]> {
    // scope-ok: see above
    const rows = await this.database.executor.execute<FamilyRow>(sql`
      UPDATE identity.refresh_family SET revoked_at = ${ts(now)}, revoked_reason = ${reason}
       WHERE kind = ${kind} AND account_id = ${accountId}::uuid AND revoked_at IS NULL
      RETURNING id, kind, account_id, building_id`)
    const families = rows.map(toRevoked)
    await this.revokeTokensOf(families, now)
    return families
  }

  async familyOfToken(tokenHash: string): Promise<{ id: string } | null> {
    const [row] = await this.database.executor
      .select({ id: refreshToken.familyId })
      .from(refreshToken)
      .where(eq(refreshToken.tokenHash, tokenHash))
    return row ?? null
  }

  // scope-ok: the sessions of one account
  async listLive(kind: AccountKind, accountId: string, now: Date): Promise<SessionRow[]> {
    const rows = await this.database.executor
      .select()
      .from(refreshFamily)
      .where(
        // scope-ok: see above
        and(
          eq(refreshFamily.kind, kind),
          eq(refreshFamily.accountId, accountId),
          isNull(refreshFamily.revokedAt),
          gt(refreshFamily.absoluteExpiresAt, now),
        ),
      )
      .orderBy(desc(refreshFamily.lastUsedAt))
    return rows.map((row) => ({
      id: row.id,
      client: row.client as Client,
      userAgent: row.userAgent,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    }))
  }

  private async finishRevocation(rows: FamilyRow[], now: Date): Promise<RevokedFamily | null> {
    const [row] = rows
    if (!row) return null
    const family = toRevoked(row)
    await this.revokeTokensOf([family], now)
    return family
  }

  private async revokeTokensOf(families: readonly RevokedFamily[], now: Date): Promise<void> {
    if (families.length === 0) return
    await this.database.executor
      .update(refreshToken)
      .set({ revokedAt: now })
      .where(
        and(
          inArray(
            refreshToken.familyId,
            families.map((family) => family.id),
          ),
          isNull(refreshToken.revokedAt),
        ),
      )
  }

  private toConsumed(
    row: FamilyRow & { family_id: string; client: Client; absolute_expires_at: Date | string },
  ): ConsumedToken {
    return {
      familyId: row.family_id,
      kind: row.kind,
      accountId: row.account_id,
      buildingId: row.building_id,
      client: row.client,
      absoluteExpiresAt: asDate(row.absolute_expires_at),
    }
  }
}
