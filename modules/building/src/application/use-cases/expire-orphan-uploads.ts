import type { Clock, UnitOfWork } from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { FileRepository } from '../../domain/file-repository'
import { BATCH_SIZE } from '../batch'
import { deleteCommand } from '../file-commands'
import type { FilesConfig } from '../files-config'
import { scopeOf } from '../scope-of'

export interface ExpireOrphanUploadsDeps {
  files: FileRepository
  uow: UnitOfWork
  outbox: OutboxWriter
  clock: Clock
  config: Pick<FilesConfig, 'orphanAfterHours'>
}

/**
 * `orphan_uploads`, one batch: `pending` and `verified` rows older than the window become `deleted`, each with its delete
 * command in the same transaction (DOC-37 §14). Returns how many; a full batch means call again.
 */
export class ExpireOrphanUploads {
  constructor(private readonly deps: ExpireOrphanUploadsDeps) {}

  async execute(buildingId: string): Promise<number> {
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
}
