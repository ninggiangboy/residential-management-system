import { applyTransition, type Database } from '@core/db'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import type { OtpChallengeRecord, OtpChallengeTransition } from '../../domain/otp-challenge'
import type { NewOtpChallenge, OtpChallengeRepository } from '../../domain/otp-challenge-repository'
import { otpChallenge } from './schema'

const toRecord = (row: typeof otpChallenge.$inferSelect): OtpChallengeRecord => ({
  id: row.id,
  phone: row.phone,
  codeHmac: row.codeHmac,
  expiresAt: row.expiresAt,
  resendAfter: row.resendAfter,
  attempts: row.attempts,
  consumedAt: row.consumedAt,
})

const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`

/** The statements of DOC-16 §4.3 and DOC-26 §5; every instant is the caller's clock, so a test decides when a code expires. */
// scope-ok: a challenge exists before the person has chosen a unit; it has no building (DOC-16 §4.3)
export class DrizzleOtpChallengeRepository implements OtpChallengeRepository {
  constructor(private readonly database: Database) {}

  // scope-ok: see above
  async issue(challenge: NewOtpChallenge, now: Date): Promise<void> {
    // Only a challenge whose resend wait is over is spent: one still inside it keeps the unique index occupied, so a second
    // request of the same instant fails the insert and waits (DOC-26 §5.1 step 3), whichever of the two read the gate first.
    // scope-ok: see above
    await this.database.executor.execute(sql`
      UPDATE identity.otp_challenge SET consumed_at = ${ts(now)}
       WHERE phone = ${challenge.phone} AND consumed_at IS NULL AND resend_after <= ${ts(now)}`)
    await this.database.executor.insert(otpChallenge).values({
      id: challenge.id,
      phone: challenge.phone,
      codeHmac: challenge.codeHmac,
      expiresAt: challenge.expiresAt,
      resendAfter: challenge.resendAfter,
      ip: challenge.ip,
      createdAt: now,
    })
  }

  // scope-ok: see above
  async findById(id: string): Promise<OtpChallengeRecord | null> {
    // scope-ok: see above
    const [row] = await this.database.executor
      .select()
      .from(otpChallenge)
      .where(eq(otpChallenge.id, id))
    return row ? toRecord(row) : null
  }

  // scope-ok: see above
  async findOpen(phone: string): Promise<OtpChallengeRecord | null> {
    // scope-ok: see above
    const [row] = await this.database.executor
      .select()
      .from(otpChallenge)
      .where(and(eq(otpChallenge.phone, phone), isNull(otpChallenge.consumedAt)))
    return row ? toRecord(row) : null
  }

  // scope-ok: see above
  async countSince(since: Date): Promise<number> {
    // scope-ok: see above
    const [row] = await this.database.executor
      .select({ n: sql<number>`count(*)::int` })
      .from(otpChallenge)
      .where(gt(otpChallenge.createdAt, since))
    return row?.n ?? 0
  }

  // scope-ok: the transition names the challenge by id, which the caller found by its id
  async apply(transition: OtpChallengeTransition): Promise<boolean> {
    return (await applyTransition(this.database, otpChallenge, transition)) !== null
  }

  // scope-ok: see above
  async applyDemo(transition: OtpChallengeTransition): Promise<boolean> {
    const flagged = sql`EXISTS (SELECT 1 FROM identity.resident_account a
                                 WHERE a.phone = ${otpChallenge.phone} AND a.is_demo)`
    return (
      (await applyTransition(this.database, otpChallenge, transition, { also: flagged })) !== null
    )
  }
}
