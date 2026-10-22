import type { Database } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import type { AuditLogRepository, AuditRow } from '../../domain/audit-log-repository'
import { auditLog } from './schema'

/** Insert only: the table has no other writer, and `rms_app` has no other privilege on it. */
export class DrizzleAuditLogRepository implements AuditLogRepository {
  constructor(private readonly database: Database) {}

  async insert(scope: BuildingScope, row: AuditRow): Promise<void> {
    await this.database.executor.insert(auditLog).values({ ...row, buildingId: scope.buildingId })
  }
}
