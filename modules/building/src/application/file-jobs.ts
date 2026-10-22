import type { Clock, UnitOfWork } from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { BuildingId, BuildingScope } from '@rms/shared-types'
import type { BuildingDirectory } from './directory'
import { deleteCommand, type FilesConfig } from './files-service'
import type { FileRepository } from './ports'

const scopeOf = (buildingId: string): BuildingScope => ({ buildingId: buildingId as BuildingId })

/** Where `storage_usage_ratio` goes (DOC-40); wired with the metrics endpoint in P1-18. A demo building is left out of the system-wide gauge (DOC-36 §9.3). */
export interface UsageReporter {
  report(buildingId: string, ratio: number, isDemo: boolean): void
}

export const BATCH_SIZE = 1000

export interface FileJobDeps {
  files: FileRepository
  directory: BuildingDirectory
  uow: UnitOfWork
  outbox: OutboxWriter
  clock: Clock
  config: Pick<FilesConfig, 'orphanAfterHours' | 'deletedRowRetentionDays'>
  usage: UsageReporter
}

/** The two hourly jobs of `building` (DOC-37 §11, §14), as plain methods the job definitions call under the job lock. */
export class FileJobs {
  constructor(private readonly deps: FileJobDeps) {}

  /** `storage_quota`: the usage of one building against its quota; the alert thresholds (0.8 and 1.0) are DOC-40's. */
  async storageQuota(
    buildingId: string,
  ): Promise<{ usedBytes: number; quotaBytes: number; ratio: number }> {
    const { files, directory, usage } = this.deps
    const [usedBytes, settings, isDemo] = await Promise.all([
      files.usedBytes(scopeOf(buildingId)),
      directory.getSettings(buildingId),
      directory.isDemo(buildingId),
    ])
    const quotaBytes = settings.storageQuotaBytes
    const ratio = usedBytes / quotaBytes
    usage.report(buildingId, ratio, isDemo)
    return { usedBytes, quotaBytes, ratio }
  }

  /**
   * `orphan_uploads`, one batch: `pending` and `verified` rows older than the window become `deleted`, each with its delete
   * command in the same transaction (DOC-37 §14). Returns how many; a full batch means call again.
   */
  async orphanBatch(buildingId: string): Promise<number> {
    const { files, uow, outbox, clock, config } = this.deps
    const scope = scopeOf(buildingId)
    const now = clock.now()
    const cutoff = new Date(now.getTime() - config.orphanAfterHours * 3_600_000)
    return uow.run(async () => {
      const orphans = await files.unattachedBefore(scope, cutoff, BATCH_SIZE)
      for (const orphan of orphans) {
        const deleted = await files.markDeleted(scope, orphan.id, now)
        if (deleted) await outbox.add([deleteCommand(deleted, now)])
      }
      return orphans.length
    })
  }

  /** The rows that have been `deleted` for longer than the retention are removed for good, in batches (DOC-20 §3). */
  async purgeDeletedBatch(buildingId: string): Promise<number> {
    const { files, uow, clock, config } = this.deps
    const cutoff = new Date(clock.now().getTime() - config.deletedRowRetentionDays * 86_400_000)
    return uow.run(() => files.purgeDeleted(scopeOf(buildingId), cutoff, BATCH_SIZE))
  }
}
