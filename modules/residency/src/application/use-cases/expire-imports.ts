import { type Clock, NotFoundError, type UnitOfWork } from '@core/kernel'
import type { FilesApi } from '@mod/building/contracts'
import type { ImportJobRepository } from '../../domain/import-job-repository'
import { IMPORT_BATCH_SIZE } from '../import-batch'
import { scopeOf } from '../scope-of'
import { systemFileActor } from '../system-file-actor'

/**
 * `import_expire`, one batch (DOC-38 §4, DOC-27 §9.4): the `validated` jobs past `expires_at` become `expired` and their upload,
 * which holds ID numbers (DR-22), is removed in the same transaction. Returns how many; a full batch means call again. The
 * reads of E-73 and E-169 already say `expired`, so this only keeps the table and the bucket honest.
 */
export class ExpireImports {
  constructor(
    private readonly files: Pick<FilesApi, 'remove'>,
    private readonly jobs: ImportJobRepository,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  execute(buildingId: string): Promise<number> {
    const now = this.clock.now()
    return this.uow.run(async () => {
      const expired = await this.jobs.expire(scopeOf(buildingId), now, IMPORT_BATCH_SIZE)
      for (const job of expired) await this.removeFile(buildingId, job.fileId)
      return expired.length
    })
  }

  private async removeFile(buildingId: string, fileId: string) {
    try {
      await this.files.remove(systemFileActor(buildingId), fileId)
    } catch (error) {
      // The file is gone already (its own retention ended first): nothing is left to remove.
      if (!(error instanceof NotFoundError)) throw error
    }
  }
}
