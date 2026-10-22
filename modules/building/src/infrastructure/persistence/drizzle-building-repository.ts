import type { Database } from '@core/db'
import { and, eq, sql } from 'drizzle-orm'
import type {
  BuildingFieldsUpdate,
  BuildingRecord,
  BuildingRepository,
} from '../../application/ports'
import { buildingTable } from './schema'

const toRecord = (row: typeof buildingTable.$inferSelect): BuildingRecord => ({
  id: row.id,
  code: row.code,
  name: row.name,
  company: row.company as unknown as BuildingRecord['company'],
  address: row.address,
  hotline: row.hotline,
  workingHours: row.workingHours ?? null,
  email: row.email,
  logoFile: row.logoFile,
  timeZone: row.timeZone,
  isDemo: row.isDemo,
  version: row.version,
})

/** `building.building` is the scope root and is on the allow-list of the scope lint (DOC-14 §5.3): its methods take the id. */
export class DrizzleBuildingRepository implements BuildingRepository {
  constructor(private readonly database: Database) {}

  async find(id: string): Promise<BuildingRecord | null> {
    const [row] = await this.database.executor
      .select()
      .from(buildingTable)
      .where(eq(buildingTable.id, id))
    return row ? toRecord(row) : null
  }

  async list(): Promise<BuildingRecord[]> {
    const rows = await this.database.executor
      .select()
      .from(buildingTable)
      .orderBy(buildingTable.code)
    return rows.map(toRecord)
  }

  async updateGuarded(
    id: string,
    expectedVersion: number,
    fields: BuildingFieldsUpdate,
  ): Promise<number | null> {
    const [row] = await this.database.executor
      .update(buildingTable)
      .set({
        ...fields,
        company: fields.company as unknown as Record<string, unknown> | undefined,
        version: sql`${buildingTable.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(buildingTable.id, id), eq(buildingTable.version, expectedVersion)))
      .returning({ version: buildingTable.version })
    return row?.version ?? null
  }
}
