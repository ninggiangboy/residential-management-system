import type { JobContext, JobDefinition } from '@core/runtime'
import { BATCH_SIZE } from '../../application/batch'
import type { ExpireOrphanUploads } from '../../application/use-cases/expire-orphan-uploads'
import type { PurgeDeletedFiles } from '../../application/use-cases/purge-deleted-files'
import type { ReportStorageQuota } from '../../application/use-cases/report-storage-quota'

/**
 * `storage_quota`, hourly at :05 (DOC-38 §4.1): the usage of every building against its quota. The gauge it feeds
 * (`storage_usage_ratio`) and the alerts at 0.8 and 1.0 are DOC-40's, wired with the metrics endpoint (P1-18).
 */
export function storageQuotaJob(reportStorageQuota: ReportStorageQuota): JobDefinition {
  return {
    name: 'storage_quota',
    schedule: { kind: 'hourly', minute: 5 },
    mode: 'lock',
    graceMinutes: 0,
    run: (ctx) =>
      ctx.withLock(async () => {
        const buildings: Record<string, number> = {}
        for (const { buildingId } of await ctx.buildings())
          buildings[buildingId] = (await reportStorageQuota.execute(buildingId)).ratio
        return { did: Object.keys(buildings).length, details: { buildings } }
      }),
  }
}

/** Runs `batch` under the job lock until one comes back short; stops at once at shutdown or in maintenance (DOC-38 §5.3). */
async function drain(ctx: JobContext, batch: () => Promise<number>) {
  let total = 0
  for (;;) {
    if (ctx.signal.aborted || ctx.paused()) return { total, stopped: true }
    const done = await ctx.withLock(batch)
    total += done
    if (done < BATCH_SIZE) return { total, stopped: false }
  }
}

/**
 * `orphan_uploads`, hourly at :15 (DOC-37 §14, DR-112): per building, the `pending` and `verified` files older than the window
 * become `deleted` with a delete command each, in batches of 1,000, then `deleted` rows older than the retention are removed.
 * One transaction per batch: the lock goes with it (DR-121).
 */
export function orphanUploadsJob(
  expireOrphanUploads: ExpireOrphanUploads,
  purgeDeletedFiles: PurgeDeletedFiles,
): JobDefinition {
  return {
    name: 'orphan_uploads',
    schedule: { kind: 'hourly', minute: 15 },
    mode: 'lock',
    graceMinutes: 0,
    run: async (ctx) => {
      let orphaned = 0
      let purged = 0
      for (const { buildingId } of await ctx.buildings()) {
        const marked = await drain(ctx, () => expireOrphanUploads.execute(buildingId))
        orphaned += marked.total
        if (marked.stopped) break
        const removed = await drain(ctx, () => purgeDeletedFiles.execute(buildingId))
        purged += removed.total
        if (removed.stopped) break
      }
      return { did: orphaned + purged, details: { orphaned, purged } }
    },
  }
}
