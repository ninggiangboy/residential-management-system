import type { BuildingScope } from '@rms/shared-types'
import type { JsonValue } from '../contracts'

/** One row of `audit.audit_log` as the writer builds it (DOC-17 §2). `at` and `retention_class` are the database's. */
export interface AuditRow {
  id: string
  actorKind: 'staff' | 'system'
  actorId: string | null
  actorRole: string | null
  ip: string | null
  userAgent: string | null
  requestId: string | null
  action: string
  objectType: string
  objectId: string
  changes: unknown[]
  details: Record<string, JsonValue>
  reason: string | null
}

/** Appends to the log in the ambient transaction. Nothing else can write the table: `rms_app` has `SELECT` and `INSERT` (DOC-19). */
export interface AuditLogRepository {
  insert(scope: BuildingScope, row: AuditRow): Promise<void>
}
