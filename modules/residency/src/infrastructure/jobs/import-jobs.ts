import type { JobContext, JobDefinition } from '@core/runtime'
import { IMPORT_BATCH_SIZE } from '../../application/import-batch'
import type { ExpireImports } from '../../application/use-cases/expire-imports'
import type { PurgeImports } from '../../application/use-cases/purge-imports'

/** Runs `batch` under the job lock until one comes back short; stops at once at shutdown or in maintenance (DOC-38 §5.3). */
async function drain(
  ctx: JobContext,
  buildingId: string,
  batch: (buildingId: string) => Promise<number>,
) {
  let total = 0
  for (;;) {
    if (ctx.signal.aborted || ctx.paused()) return { total, stopped: true }
    const done = await ctx.withLock(() => batch(buildingId))
    total += done
    if (done < IMPORT_BATCH_SIZE) return { total, stopped: false }
  }
}

async function overBuildings(
  ctx: JobContext,
  batch: (buildingId: string) => Promise<number>,
): Promise<number> {
  let total = 0
  for (const { buildingId } of await ctx.buildings()) {
    const done = await drain(ctx, buildingId, batch)
    total += done.total
    if (done.stopped) break
  }
  return total
}

/** `import_expire`, hourly at :25 (DOC-38 §4.1, DR-114): `validated` jobs past `expires_at` become `expired` and lose their file. */
export function importExpireJob(expireImports: ExpireImports): JobDefinition {
  return {
    name: 'import_expire',
    schedule: { kind: 'hourly', minute: 25 },
    mode: 'lock',
    graceMinutes: 0,
    run: async (ctx) => {
      const expired = await overBuildings(ctx, (id) => expireImports.execute(id))
      return { did: expired, details: { expired } }
    },
  }
}

/** `import_purge`, Sunday 04:00 (DOC-38 §4.1, DR-21, DR-62): jobs and files older than 30 days go. */
export function importPurgeJob(purgeImports: PurgeImports): JobDefinition {
  return {
    name: 'import_purge',
    schedule: { kind: 'weekly', day: 'sun', at: '04:00' },
    mode: 'lock',
    graceMinutes: 24 * 60,
    run: async (ctx) => {
      const deleted = await overBuildings(ctx, (id) => purgeImports.execute(id))
      return { did: deleted, details: { deleted } }
    },
  }
}
