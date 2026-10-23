import type { Clock, UnitOfWork } from '@core/kernel'
import type { FileRepository } from '../../domain/file-repository'
import { BATCH_SIZE } from '../batch'
import type { FileDeleter } from '../file-deleter'
import type { FilesConfig } from '../files-config'
import { scopeOf } from '../scope-of'

/**
 * `orphan_uploads`, one batch: `pending` and `verified` rows older than the window become `deleted`, each with its delete
 * command in the same transaction (DOC-37 §14). Returns how many; a full batch means call again.
 */
export class ExpireOrphanUploads {
  constructor(
    private readonly files: FileRepository,
    private readonly uow: UnitOfWork,
    private readonly deleter: FileDeleter,
    private readonly clock: Clock,
    private readonly config: Pick<FilesConfig, 'orphanAfterHours'>,
  ) {}

  async execute(buildingId: string): Promise<number> {
    const { files, uow, deleter, clock, config } = this
    const scope = scopeOf(buildingId)
    const now = clock.now()
    const cutoff = new Date(now.getTime() - config.orphanAfterHours * 3_600_000)
    return uow.run(async () => {
      const orphans = await files.unattachedBefore(scope, cutoff, BATCH_SIZE)
      for (const orphan of orphans) await deleter.delete(scope, orphan, now)
      return orphans.length
    })
  }
}
