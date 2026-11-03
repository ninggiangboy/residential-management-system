import type { JobDefinition } from '@core/runtime'
import type { RealtimeStore } from '../../application/ports'

/** The retention of the replay buffer (DR-115, DOC-17 §9.1). */
const REALTIME_RETENTION_HOURS = 24
const BATCH = 1000

/**
 * `realtime_purge`, hourly at :45, mode `lock`, a row every run (DOC-38 §4.1, DR-120): deletes events older than 24 hours in
 * batches of 1,000. The result is `{"deleted": n}`.
 */
export function realtimePurgeJob(store: RealtimeStore): JobDefinition {
  return {
    name: 'realtime_purge',
    schedule: { kind: 'hourly', minute: 45 },
    mode: 'lock',
    graceMinutes: 0,
    run: async (ctx) => {
      const cutoff = new Date(ctx.clock.now().getTime() - REALTIME_RETENTION_HOURS * 3_600_000)
      let deleted = 0
      for (;;) {
        if (ctx.signal.aborted || ctx.paused()) break
        const n = await ctx.withLock(() => store.purgeOlderThan(cutoff, BATCH))
        deleted += n
        if (n < BATCH) break
      }
      return { did: deleted, details: { deleted } }
    },
  }
}
