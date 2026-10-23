import { applyTransition, type Database } from '@core/db'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type {
  PasswordTokenRecord,
  PasswordTokenTransition,
  StepUpAction,
} from '../../domain/password-token'
import type {
  NewLink,
  NewStepUpCode,
  PasswordTokenRepository,
} from '../../domain/password-token-repository'
import { passwordToken } from './schema'

const toRecord = (row: typeof passwordToken.$inferSelect): PasswordTokenRecord => ({
  id: row.id,
  staffId: row.staffId,
  kind: row.kind as PasswordTokenRecord['kind'],
  action: row.action as StepUpAction | null,
  tokenHash: row.tokenHash,
  attempts: row.attempts,
  expiresAt: row.expiresAt,
  consumedAt: row.consumedAt,
})

const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`

/** The statements of DOC-16 §4.4; every instant is the caller's clock, so a test decides when a link expires. */
// scope-ok: a token is found by its hash, or by the staff member and the action of a caller the guard has authorised
export class DrizzlePasswordTokenRepository implements PasswordTokenRepository {
  constructor(private readonly database: Database) {}

  // scope-ok: the staff id comes from a row the use case has read
  async issueLink(link: NewLink, now: Date): Promise<void> {
    // scope-ok: see above
    await this.database.executor.execute(sql`
      UPDATE identity.password_token SET consumed_at = ${ts(now)}
       WHERE staff_id = ${link.staffId}::uuid AND kind = ${link.kind} AND consumed_at IS NULL`)
    await this.insert({ ...link, action: null, codeHash: link.tokenHash }, now)
  }

  // scope-ok: the hash is the credential
  async findLink(tokenHash: string): Promise<PasswordTokenRecord | null> {
    // scope-ok: see above
    const [row] = await this.database.executor
      .select()
      .from(passwordToken)
      .where(
        and(
          eq(passwordToken.tokenHash, tokenHash),
          inArray(passwordToken.kind, ['reset', 'invite']),
        ),
      )
    return row ? toRecord(row) : null
  }

  // scope-ok: bound to the staff member and the action of the caller
  async findStepUp(staffId: string, action: StepUpAction): Promise<PasswordTokenRecord | null> {
    // scope-ok: see above
    const [row] = await this.database.executor
      .select()
      .from(passwordToken)
      .where(
        and(
          eq(passwordToken.staffId, staffId),
          eq(passwordToken.kind, 'step_up'),
          eq(passwordToken.action, action),
          isNull(passwordToken.consumedAt),
        ),
      )
      .orderBy(desc(passwordToken.createdAt))
      .limit(1)
    return row ? toRecord(row) : null
  }

  // scope-ok: the transition names the token by id, which the caller found by its hash or its owner
  async apply(transition: PasswordTokenTransition): Promise<boolean> {
    return (await applyTransition(this.database, passwordToken, transition)) !== null
  }

  // scope-ok: the staff id comes from the caller's own row
  async issueStepUp(code: NewStepUpCode, now: Date): Promise<void> {
    // scope-ok: see above
    await this.database.executor.execute(sql`
      UPDATE identity.password_token SET consumed_at = ${ts(now)}
       WHERE staff_id = ${code.staffId}::uuid AND kind = 'step_up' AND action = ${code.action} AND consumed_at IS NULL`)
    await this.insert({ ...code, kind: 'step_up', codeHash: code.codeHmac }, now)
  }

  private async insert(
    row: {
      id: string
      buildingId: string
      staffId: string
      kind: 'reset' | 'invite' | 'step_up'
      action: StepUpAction | null
      codeHash: string
      expiresAt: Date
    },
    now: Date,
  ): Promise<void> {
    await this.database.executor.insert(passwordToken).values({
      id: row.id,
      buildingId: row.buildingId,
      staffId: row.staffId,
      kind: row.kind,
      action: row.action,
      tokenHash: row.codeHash,
      expiresAt: row.expiresAt,
      createdAt: now,
    })
  }
}
