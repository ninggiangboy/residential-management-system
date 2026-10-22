import type { Database } from '@core/db'
import type { AppModule, ModuleHost } from '@core/runtime'
import { AuditWriter } from './application/audit-writer'
import { createAudited } from './application/audited'
import type { AuditActionCatalog, AuditMetrics } from './application/ports'
import type { AuditApi, Audited } from './contracts'
import { auditPurgeJob } from './infrastructure/jobs/audit-purge'
import { DrizzleAuditLogRepository } from './infrastructure/persistence/drizzle-audit-log-repository'
import { requestInfoFromContext } from './infrastructure/request-info'

export { auditActionCatalogOf } from './application/action-catalog'
export { auditManifest } from './manifest'

export interface AuditDeps {
  /** Every audit action the installed modules declared (`auditActionCatalogOf(MODULE_CATALOG)`). */
  actions: AuditActionCatalog
  /** `JOB_AUDIT_PURGE_GRACE_MINUTES` (DOC-41 §11). */
  purgeGraceMinutes: number
  metrics?: AuditMetrics
}

export interface AuditModule extends AppModule<'audit'> {
  /** `AuditApi` for every module: it joins the caller's transaction (ADR-0018). */
  readonly api: AuditApi
  /** The wrapper of DOC-35 §3.2, bound to `api`. */
  readonly audited: Audited
}

/** The host narrowed to what `audit` needs: it states its dependencies in its signature (DOC-12 §4.2). */
export type AuditHost = Pick<ModuleHost, 'logger' | 'ids' | 'database'> & AuditDeps

export function installAudit(host: AuditHost): AuditModule {
  const database: Database = host.database
  const api = new AuditWriter({
    repository: new DrizzleAuditLogRepository(database),
    transaction: database,
    ids: host.ids,
    actions: host.actions,
    requestInfo: requestInfoFromContext,
    logger: host.logger,
    metrics: host.metrics,
  })
  return {
    name: 'audit',
    api,
    audited: createAudited(api),
    jobs: [auditPurgeJob(database, host.purgeGraceMinutes)],
  }
}
