import type { JobDefinition } from '@core/runtime'
import type { PushConfig } from '../../application/push-config'
import type { InboxEntryRepository } from '../../domain/inbox-entry-repository'

/** The batch of DOC-31 §4.5 (OPM-S24): a full batch means there may be more, a short one ends the run. */
const PURGE_BATCH = 1000
const DAY_MS = 86_400_000

/**
 * `inbox_purge`, Sunday 04:00 local, mode `lock`, grace 24 h (DOC-31 §4.5, DOC-38 §4.1; DR-53, DR-62, DR-115). It deletes
 * entries older than `INBOX_RETENTION_DAYS` (180) in batches of 1,000, each batch in its own transaction under the job lock;
 * read or not, an entry ages out. The results are `{"deleted": n}`.
 */
export function inboxPurgeJob(
  entries: InboxEntryRepository,
  config: PushConfig,
  graceMinutes: number,
): JobDefinition {
  return {
    name: 'inbox_purge',
    schedule: { kind: 'weekly', day: 'sun', at: '04:00' },
    mode: 'lock',
    graceMinutes,
    run: async (ctx) => {
      const cutoff = new Date(ctx.clock.now().getTime() - config.inboxRetentionDays * DAY_MS)
      let deleted = 0
      for (;;) {
        if (ctx.signal.aborted || ctx.paused()) break
        const purged = await ctx.withLock(() => entries.purgeOlderThan(cutoff, PURGE_BATCH))
        deleted += purged
        if (purged < PURGE_BATCH) break
      }
      return { did: deleted, details: { deleted } }
    },
  }
}
