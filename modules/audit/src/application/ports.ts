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
  /** `audit_purge_rows_total{class}`: the rows one run of `audit_purge` deleted for a retention class. */
  purged?(scope: 'finance' | 'standard', rows: number): void
}
