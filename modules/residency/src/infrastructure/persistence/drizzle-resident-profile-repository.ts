import type { Database } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, eq } from 'drizzle-orm'
import type {
  ResidentProfileRecord,
  ResidentProfileTransition,
} from '../../domain/resident-profile'
import type { ResidentProfileRepository } from '../../domain/resident-profile-repository'
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
