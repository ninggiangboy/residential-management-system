import { type Database, inBuilding } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, eq, sql } from 'drizzle-orm'
import type { SettingsRecord, SettingsRepository } from '../../application/ports'
import { buildingSetting } from './schema'

export class DrizzleSettingsRepository implements SettingsRepository {
  constructor(private readonly database: Database) {}

  async find(scope: BuildingScope): Promise<SettingsRecord | null> {
    const [row] = await this.database.executor
      .select({ data: buildingSetting.data, version: buildingSetting.version })
      .from(buildingSetting)
      .where(inBuilding(buildingSetting, scope))
    return row ?? null
  }

  /** `data = (data || :set) - :remove`, guarded by the version the client read (DOC-36 §4.3). */
  async mergeGuarded(
    scope: BuildingScope,
    expectedVersion: number,
    set: Record<string, unknown>,
    remove: string[],
  ): Promise<SettingsRecord | null> {
    const removed =
      remove.length === 0
        ? sql`ARRAY[]::text[]`
        : sql`ARRAY[${sql.join(
            remove.map((key) => sql`${key}`),
            sql`, `,
          )}]::text[]`
    const [row] = await this.database.executor
      .update(buildingSetting)
      .set({
        data: sql`(${buildingSetting.data} || ${JSON.stringify(set)}::jsonb) - ${removed}`,
        version: sql`${buildingSetting.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(inBuilding(buildingSetting, scope), eq(buildingSetting.version, expectedVersion)))
      .returning({ data: buildingSetting.data, version: buildingSetting.version })
    return row ?? null
  }
}
