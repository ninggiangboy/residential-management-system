import type { Database } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, eq, sql } from 'drizzle-orm'
import type {
  ResidentProfileRecord,
  ResidentProfileTransition,
} from '../../domain/resident-profile'
import type {
  ProfileSeed,
  ResidentProfileRepository,
} from '../../domain/resident-profile-repository'
import { residentProfile } from './schema'

const toRecord = (row: typeof residentProfile.$inferSelect): ResidentProfileRecord => ({
  buildingId: row.buildingId,
  accountId: row.accountId,
  fullName: row.fullName,
  email: row.email,
  cccdEnc: row.cccdEnc,
  cccdLast4: row.cccdLast4,
  dateOfBirth: row.dateOfBirth,
  note: row.note,
  clearedAt: row.clearedAt,
  version: row.version,
})

export class DrizzleResidentProfileRepository implements ResidentProfileRepository {
  constructor(private readonly database: Database) {}

  async find(scope: BuildingScope, accountId: string): Promise<ResidentProfileRecord | null> {
    const [row] = await this.database.executor
      .select()
      .from(residentProfile)
      .where(
        and(
          eq(residentProfile.buildingId, scope.buildingId),
          eq(residentProfile.accountId, accountId),
        ),
      )
    return row ? toRecord(row) : null
  }

  async ensure(scope: BuildingScope, seed: ProfileSeed, now: Date): Promise<boolean> {
    // The fill only touches a stored empty field, so a second add never replaces what the Manager wrote (S2, S9).
    const rows = await this.database.executor
      .insert(residentProfile)
      .values({
        buildingId: scope.buildingId,
        accountId: seed.accountId,
        fullName: seed.fullName,
        email: seed.email,
        note: seed.note,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [residentProfile.buildingId, residentProfile.accountId],
        set: {
          email: sql`COALESCE(${residentProfile.email}, excluded.email)`,
          note: sql`COALESCE(${residentProfile.note}, excluded.note)`,
          updatedAt: now,
          version: sql`${residentProfile.version} + 1`,
        },
        setWhere: sql`(${residentProfile.email} IS NULL AND excluded.email IS NOT NULL)
          OR (${residentProfile.note} IS NULL AND excluded.note IS NOT NULL)`,
      })
      .returning({ accountId: residentProfile.accountId })
    return rows.length > 0
  }

  /** The key is `(building, account)`, not an `id`, so this is its own statement rather than `applyTransition`. */
  async apply(
    scope: BuildingScope,
    transition: ResidentProfileTransition,
    now: Date,
  ): Promise<ResidentProfileRecord | null> {
    const [row] = await this.database.executor
      .update(residentProfile)
      .set({ ...transition.set, updatedAt: now })
      .where(
        and(
          eq(residentProfile.buildingId, scope.buildingId),
          eq(residentProfile.accountId, transition.id),
          eq(residentProfile.version, transition.expect.version as number),
        ),
      )
      .returning()
    return row ? toRecord(row) : null
  }
}
