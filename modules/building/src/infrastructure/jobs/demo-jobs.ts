import type { JobDefinition } from '@core/runtime'
import type { DemoReset } from '../../application/demo-reset'
import type { BuildingDirectory } from '../../application/directory'

/**
 * `demo_reset`, daily at 04:00 local (DOC-38 §4.1, DOC-36 §10.3): for each building flagged `is_demo`, the reset of `DemoReset` under
 * the job lock; a real building is never listed. It writes no audit row (DOC-35 §3.6), and a failure is retried at the next slot
 * only: the alert is the gauge `job_last_success_timestamp{job="demo_reset"}`.
 */
export function demoResetJob(
  directory: BuildingDirectory,
  demoReset: DemoReset,
  graceMinutes: number,
): JobDefinition {
  return {
    name: 'demo_reset',
    schedule: { kind: 'daily', at: '04:00' },
    mode: 'lock',
    graceMinutes,
    run: async (ctx) => {
      let buildings = 0
      for (const { buildingId, isDemo } of await directory.listBuildings()) {
        if (!isDemo) continue
        if (ctx.signal.aborted || ctx.paused()) break
        await ctx.withLock(() => demoReset.run(buildingId))
        buildings++
      }
      return { did: buildings, details: { buildings } }
    },
  }
}
