import type { Database } from '@core/db'
import type { JobDefinition } from '@core/runtime'
import { sql } from 'drizzle-orm'
import type { AuditMetrics } from '../../application/ports'

const SCOPES = ['finance', 'standard'] as const

/**
 * `audit_purge`: monthly, day 1 at 04:30 (DOC-38 §4.1, DR-62). The only deleter of the log runs as `rms_app` and calls the
 * `SECURITY DEFINER` function, which clamps the cut-off to the retention floor itself (DR-110, DOC-17 §2): whatever this job
 * asks, a row younger than 5 years (finance) or 2 years (the rest) stays.
 */
export function auditPurgeJob(
  database: Database,
  graceMinutes: number,
  metrics?: AuditMetrics,
): JobDefinition {
  return {
    name: 'audit_purge',
    schedule: { kind: 'monthly', day: 1, at: '04:30' },
    mode: 'lock',
    graceMinutes,
    run: (ctx) =>
      ctx.withLock(async () => {
        const deleted: Record<string, number> = {}
        for (const scope of SCOPES) {
          const rows = await database.executor.execute<{ purged: string }>(
            sql`select audit.purge(${ctx.clock.now().toISOString()}::timestamptz, ${scope}) as purged`,
          )
          deleted[scope] = Number(rows[0]?.purged ?? 0)
          metrics?.purged?.(scope, deleted[scope])
        }
        const did = Object.values(deleted).reduce((sum, n) => sum + n, 0)
        return { did, details: deleted }
      }),
  }
}
