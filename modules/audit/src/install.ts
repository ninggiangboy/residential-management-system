import type { ModuleHost } from '@core/runtime'
import { type AuditDeps, type AuditModule, createAuditModule } from './audit.module'

/** The host narrowed to what `audit` needs: it states its dependencies in its signature (DOC-12 §4.2). */
export type AuditHost = Pick<ModuleHost, 'logger' | 'ids' | 'database'> & AuditDeps

export function installAudit(host: AuditHost): AuditModule {
  return createAuditModule({
    database: host.database,
    ids: host.ids,
    logger: host.logger,
    actions: host.actions,
    purgeGraceMinutes: host.purgeGraceMinutes,
    metrics: host.metrics,
  })
}
