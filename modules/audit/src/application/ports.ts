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

/** Whether a transaction is open: `record` refuses to run outside one. The `Database` of `@core/db` satisfies it. */
export interface TransactionProbe {
  readonly inTransaction: boolean
}

/** What the request says about itself, from `@core/context`; all `null` in a job or an inbox handler (DOC-35 §3.2). */
interface RequestInfo {
  requestId: string | null
  ip: string | null
  userAgent: string | null
}
export type RequestInfoProvider = () => RequestInfo

/** The actions each module declared in its manifest (`auditActions`, DOC-35 §3.3). */
export interface AuditActionCatalog {
  isDeclared(action: string): boolean
}

export interface AuditMetrics {
  /** `audit_write_failures_total` (DOC-40); wired with the metrics endpoint in P1-18. */
  writeFailed(): void
}
