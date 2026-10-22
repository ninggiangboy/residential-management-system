import { type Database, inBuilding } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, eq, sql } from 'drizzle-orm'
import type { GatewayConfigRecord, GatewayConfigRepository } from '../../application/ports'
import { gatewayConfig } from './schema'

const toRecord = (row: typeof gatewayConfig.$inferSelect): GatewayConfigRecord => ({
  id: row.id,
  buildingId: row.buildingId,
  provider: row.provider as GatewayConfigRecord['provider'],
  driver: row.driver as GatewayConfigRecord['driver'],
  secretsEnc: row.secretsEnc,
  receivingAccount: row.receivingAccount as unknown as GatewayConfigRecord['receivingAccount'],
  status: row.status as GatewayConfigRecord['status'],
  lastCheckAt: row.lastCheckAt,
  lastCheckOk: row.lastCheckOk,
  version: row.version,
})

export class DrizzleGatewayConfigRepository implements GatewayConfigRepository {
  constructor(private readonly database: Database) {}

  async findActive(
    scope: BuildingScope,
    provider: GatewayConfigRecord['provider'],
    lock?: 'share' | 'update',
  ): Promise<GatewayConfigRecord | null> {
    const query = this.database.executor
      .select()
      .from(gatewayConfig)
      .where(
        and(
          inBuilding(gatewayConfig, scope),
          eq(gatewayConfig.provider, provider),
          eq(gatewayConfig.status, 'active'),
        ),
      )
    const [row] = await (lock ? query.for(lock) : query)
    return row ? toRecord(row) : null
  }

  async lockForUpdate(
    scope: BuildingScope,
    id: string,
    expectedVersion: number,
  ): Promise<GatewayConfigRecord | null> {
    const [row] = await this.database.executor
      .select()
      .from(gatewayConfig)
      .where(
        and(
          inBuilding(gatewayConfig, scope),
          eq(gatewayConfig.id, id),
          eq(gatewayConfig.version, expectedVersion),
        ),
      )
      .for('update')
    return row ? toRecord(row) : null
  }

  async insert(
    scope: BuildingScope,
    record: Omit<GatewayConfigRecord, 'version' | 'lastCheckAt' | 'lastCheckOk'>,
  ): Promise<void> {
    await this.database.executor.insert(gatewayConfig).values({
      id: record.id,
      buildingId: scope.buildingId,
      provider: record.provider,
      driver: record.driver,
      secretsEnc: record.secretsEnc,
      receivingAccount: record.receivingAccount as unknown as Record<string, unknown>,
      status: record.status,
    })
  }

  async updateGuarded(
    scope: BuildingScope,
    id: string,
    expectedVersion: number,
    fields: Pick<GatewayConfigRecord, 'secretsEnc' | 'receivingAccount' | 'driver' | 'status'>,
  ): Promise<number | null> {
    const [row] = await this.database.executor
      .update(gatewayConfig)
      .set({
        secretsEnc: fields.secretsEnc,
        receivingAccount: fields.receivingAccount as unknown as Record<string, unknown>,
        driver: fields.driver,
        status: fields.status,
        lastCheckAt: null,
        lastCheckOk: null,
        version: sql`${gatewayConfig.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          inBuilding(gatewayConfig, scope),
          eq(gatewayConfig.id, id),
          eq(gatewayConfig.version, expectedVersion),
        ),
      )
      .returning({ version: gatewayConfig.version })
    return row?.version ?? null
  }

  /** The compare-and-set of the key rotation (DOC-17 §1.3): zero rows when someone else wrote the row first. */
  async replaceBlob(
    scope: BuildingScope,
    id: string,
    oldBlob: string,
    newBlob: string,
  ): Promise<boolean> {
    const rows = await this.database.executor
      .update(gatewayConfig)
      .set({
        secretsEnc: newBlob,
        version: sql`${gatewayConfig.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          inBuilding(gatewayConfig, scope),
          eq(gatewayConfig.id, id),
          eq(gatewayConfig.secretsEnc, oldBlob),
        ),
      )
      .returning({ id: gatewayConfig.id })
    return rows.length === 1
  }
}
