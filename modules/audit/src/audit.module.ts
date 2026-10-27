import type { Database } from '@core/db'
import type { IdGenerator, Log } from '@core/kernel'
import type { AppModule } from '@core/runtime'
import { AuditApiImpl } from './application/api/audit-api-impl'
import { createAudited } from './application/audited'
import type { AuditActionCatalog, AuditMetrics } from './application/ports'
import { RecordAuditEntry } from './application/use-cases/record-audit-entry'
import type { AuditApi, Audited } from './contracts'
import { auditPurgeJob } from './infrastructure/jobs/audit-purge'
import { DrizzleAuditLogRepository } from './infrastructure/persistence/drizzle-audit-log-repository'
import { requestInfoFromContext } from './infrastructure/request-info'

export interface AuditDeps {
  /** Every audit action the installed modules declared (`auditActionCatalogOf(MODULE_CATALOG)`). */
  actions: AuditActionCatalog
  /** `JOB_AUDIT_PURGE_GRACE_MINUTES` (DOC-41 §11). */
  purgeGraceMinutes: number
  metrics?: AuditMetrics
}

export interface AuditModuleDeps extends AuditDeps {
  database: Database
  ids: IdGenerator
  logger: Log
}

export interface AuditModule extends AppModule<'audit'> {
  /** `AuditApi` for every module: it joins the caller's transaction (ADR-0018). */
  readonly api: AuditApi
  /** The wrapper of DOC-35 §3.2, bound to `api`. */
  readonly audited: Audited
}

/** Builds the module from what it needs; `install.ts` narrows the host to this (DOC-12 §4.2). */
export function createAuditModule(deps: AuditModuleDeps): AuditModule {
  const { database } = deps
  const api = new AuditApiImpl(
    new RecordAuditEntry(
      new DrizzleAuditLogRepository(database),
      database,
      deps.ids,
      deps.actions,
      requestInfoFromContext,
      deps.logger,
      deps.metrics,
    ),
  )
  return {
    name: 'audit',
    api,
    audited: createAudited(api),
    jobs: [auditPurgeJob(database, deps.purgeGraceMinutes, deps.metrics)],
  }
}
