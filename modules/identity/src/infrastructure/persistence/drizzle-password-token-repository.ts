import type { Database } from '@core/db'
import { sql } from 'drizzle-orm'
import type {
  LinkKind,
  NewLink,
  NewStepUpCode,
  PasswordTokenRepository,
  StepUpAction,
} from '../../domain/password-token-repository'
import { passwordToken } from './schema'

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
  async consumeLink(
    tokenHash: string,
    now: Date,
  ): Promise<{ staffId: string; kind: LinkKind } | null> {
    // scope-ok: see above
    const rows = await this.database.executor.execute<{ staff_id: string; kind: LinkKind }>(sql`
      UPDATE identity.password_token SET consumed_at = ${ts(now)}
       WHERE token_hash = ${tokenHash} AND kind IN ('reset', 'invite') AND consumed_at IS NULL AND expires_at > ${ts(now)}
      RETURNING staff_id, kind`)
    const [row] = rows
    return row ? { staffId: row.staff_id, kind: row.kind } : null
  }

  // scope-ok: the staff id comes from the caller's own row
  async issueStepUp(code: NewStepUpCode, now: Date): Promise<void> {
    // scope-ok: see above
    await this.database.executor.execute(sql`
      UPDATE identity.password_token SET consumed_at = ${ts(now)}
       WHERE staff_id = ${code.staffId}::uuid AND kind = 'step_up' AND action = ${code.action} AND consumed_at IS NULL`)
    await this.insert({ ...code, kind: 'step_up', codeHash: code.codeHmac }, now)
  }

  // scope-ok: bound to the staff member and the action of the caller
  async consumeStepUp(
    staffId: string,
    action: StepUpAction,
    codeHmac: string,
    now: Date,
    maxAttempts: number,
  ): Promise<boolean> {
    // scope-ok: see above
    const rows = await this.database.executor.execute(sql`
      UPDATE identity.password_token SET consumed_at = ${ts(now)}
       WHERE staff_id = ${staffId}::uuid AND kind = 'step_up' AND action = ${action} AND token_hash = ${codeHmac}
         AND consumed_at IS NULL AND expires_at > ${ts(now)} AND attempts < ${maxAttempts}::int
      RETURNING id`)
    return rows.length > 0
  }

  // scope-ok: bound to the staff member and the action of the caller
  async countStepUpFailure(
    staffId: string,
    action: StepUpAction,
    maxAttempts: number,
    now: Date,
  ): Promise<void> {
    // scope-ok: see above
    await this.database.executor.execute(sql`
      UPDATE identity.password_token
         SET attempts = attempts + 1,
             consumed_at = CASE WHEN attempts + 1 >= ${maxAttempts}::int THEN ${ts(now)} END
       WHERE staff_id = ${staffId}::uuid AND kind = 'step_up' AND action = ${action} AND consumed_at IS NULL`)
  }

  // scope-ok: bound to the staff member and the action of the caller
  async stepUpAttemptsLeft(
    staffId: string,
    action: StepUpAction,
    maxAttempts: number,
    now: Date,
  ): Promise<number> {
    // scope-ok: see above
    const rows = await this.database.executor.execute<{ attempts: number }>(sql`
      SELECT attempts FROM identity.password_token
       WHERE staff_id = ${staffId}::uuid AND kind = 'step_up' AND action = ${action}
         AND consumed_at IS NULL AND expires_at > ${ts(now)}`)
    const [row] = rows
    return row ? Math.max(0, maxAttempts - Number(row.attempts)) : 0
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
