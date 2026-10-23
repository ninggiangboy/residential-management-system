import type { Database } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import type { UnitHistoryEntry, UnitHistoryRepository } from '../../domain/unit-history-repository'
import { unitHistory } from './schema'

export class DrizzleUnitHistoryRepository implements UnitHistoryRepository {
  constructor(private readonly database: Database) {}

  async add(scope: BuildingScope, entry: UnitHistoryEntry, at: Date): Promise<void> {
    await this.database.executor.insert(unitHistory).values({
      id: entry.id,
      buildingId: scope.buildingId,
      unitId: entry.unitId,
      kind: entry.kind,
      actorKind: entry.actor.kind,
      actorId: entry.actor.id,
      at,
      details: entry.details,
    })
  }
}
