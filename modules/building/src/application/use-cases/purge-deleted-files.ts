import type { Clock, UnitOfWork } from '@core/kernel'
import type { FileRepository } from '../../domain/file-repository'
import { BATCH_SIZE } from '../batch'
import type { FilesConfig } from '../files-config'
import { scopeOf } from '../scope-of'

export interface PurgeDeletedFilesDeps {
  files: FileRepository
  uow: UnitOfWork
  clock: Clock
  config: Pick<FilesConfig, 'deletedRowRetentionDays'>
}

/** The rows that have been `deleted` for longer than the retention are removed for good, in batches (DOC-20 §3). */
export class PurgeDeletedFiles {
  constructor(private readonly deps: PurgeDeletedFilesDeps) {}

  async execute(buildingId: string): Promise<number> {
    const { files, uow, clock, config } = this.deps
    const cutoff = new Date(clock.now().getTime() - config.deletedRowRetentionDays * 86_400_000)
    return uow.run(() => files.purgeDeleted(scopeOf(buildingId), cutoff, BATCH_SIZE))
  }
}
