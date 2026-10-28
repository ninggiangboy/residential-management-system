import type { JobDefinition } from '@core/runtime'
import type { RollUpUsage } from '../../application/use-cases/roll-up-usage'

/**
 * `usage_rollup`, daily at 02:30 in `JOBS_TIME_ZONE`, mode `lock`, grace 12 hours, a row every run (DOC-38 §4.1, §4.3; DOC-104 §7.1).
 * It works one building at a time, each under the job lock like `orphan_uploads`; the demo building writes no rows, so it has none
 * to roll up. The result is `{"rolled": n, "purgedRaw": n, "purgedDaily": n}`.
 */
export function usageRollupJob(rollUp: RollUpUsage, graceMinutes: number): JobDefinition {
  return {
    name: 'usage_rollup',
    schedule: { kind: 'daily', at: '02:30' },
    mode: 'lock',
    graceMinutes,
    run: async (ctx) => {
      const totals = { rolled: 0, purgedRaw: 0, purgedDaily: 0 }
      for (const { buildingId } of await ctx.buildings()) {
        if (ctx.signal.aborted || ctx.paused()) break
        const done = await ctx.withLock(() => rollUp.execute(buildingId))
        totals.rolled += done.rolled
        totals.purgedRaw += done.purgedRaw
        totals.purgedDaily += done.purgedDaily
      }
      return { did: totals.rolled + totals.purgedRaw + totals.purgedDaily, details: totals }
    },
  }
}
