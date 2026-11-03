import { applyTransition, type Database } from '@core/db'
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import type { RevocationReason } from '../../contracts'
import type {
  AccountKind,
  Client,
  FamilyRecord,
  FamilyTransition,
  RevokedFamily,
  TokenRecord,
  TokenTransition,
} from '../../domain/refresh-family'
import type {
  FoundToken,
  NewFamily,
  NewToken,
  SessionRepository,
  SessionRow,
} from '../../domain/session-repository'
import { refreshFamily, refreshToken } from './schema'

const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`

const toFamily = (row: typeof refreshFamily.$inferSelect): FamilyRecord => ({
  id: row.id,
  kind: row.kind as AccountKind,
  accountId: row.accountId,
  buildingId: row.buildingId,
  client: row.client as Client,
  absoluteExpiresAt: row.absoluteExpiresAt,
  lastUsedAt: row.lastUsedAt,
  revokedAt: row.revokedAt,
  revokedReason: row.revokedReason as RevocationReason | null,
})

const toToken = (row: typeof refreshToken.$inferSelect): TokenRecord => ({
  id: row.id,
  familyId: row.familyId,
  expiresAt: row.expiresAt,
  revokedAt: row.revokedAt,
  replacedById: row.replacedById,
})

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
  async findByToken(tokenHash: string): Promise<FoundToken | null> {
    // scope-ok: see above
    const [row] = await this.database.executor
      .select({ token: refreshToken, family: refreshFamily })
      .from(refreshToken)
      .innerJoin(refreshFamily, eq(refreshFamily.id, refreshToken.familyId))
      .where(eq(refreshToken.tokenHash, tokenHash))
    return row ? { family: toFamily(row.family), token: toToken(row.token) } : null
  }

  // scope-ok: the id is a family the caller has just proved, listed or owns
  async findFamily(familyId: string): Promise<FamilyRecord | null> {
    // scope-ok: see above
    const [row] = await this.database.executor
      .select()
      .from(refreshFamily)
      .where(eq(refreshFamily.id, familyId))
    return row ? toFamily(row) : null
  }

  // scope-ok: the transition names the token by id, which the caller found by its hash
  async rotateToken(transition: TokenTransition): Promise<boolean> {
    const familyLive = sql`EXISTS (SELECT 1 FROM identity.refresh_family f
                                    WHERE f.id = ${refreshToken.familyId} AND f.revoked_at IS NULL)`
    return (
      (await applyTransition(this.database, refreshToken, transition, { also: familyLive })) !==
      null
    )
  }

  // scope-ok: the transition names the family by id
  async revokeFamily(transition: FamilyTransition, now: Date): Promise<boolean> {
    if (!(await this.applyFamily(transition))) return false
    await this.revokeTokensOf([{ id: transition.id }], now)
    return true
  }

  // scope-ok: the transition names the family by id
  async applyFamily(transition: FamilyTransition): Promise<boolean> {
    return (await applyTransition(this.database, refreshFamily, transition)) !== null
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

  /** The predicate of the session list for a set of ids the caller holds, from device tokens (DOC-26 §3.7, DR-300). */
  // scope-ok: ids come from device tokens the caller holds; a family of any kind and account may be asked about
  async liveIds(ids: readonly string[], now: Date): Promise<string[]> {
    if (ids.length === 0) return []
    // scope-ok: see above
    const rows = await this.database.executor
      .select({ id: refreshFamily.id })
      .from(refreshFamily)
      .where(
        and(
          inArray(refreshFamily.id, [...ids]),
          isNull(refreshFamily.revokedAt),
          gt(refreshFamily.absoluteExpiresAt, now),
        ),
      )
    return rows.map((row) => row.id)
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

  private async revokeTokensOf(families: readonly { id: string }[], now: Date): Promise<void> {
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
}
