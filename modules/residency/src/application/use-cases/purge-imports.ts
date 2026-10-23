import { type Clock, NotFoundError, type UnitOfWork } from '@core/kernel'
import type { FilesApi } from '@mod/building/contracts'
import type { ImportJobRepository } from '../../domain/import-job-repository'
import { IMPORT_BATCH_SIZE } from '../import-batch'
import { scopeOf } from '../scope-of'
import { systemFileActor } from '../system-file-actor'

/** Jobs and their files are kept 30 days (DR-21, DR-62). */
const RETENTION_DAYS = 30

/**
 * `import_purge`, one batch (DOC-38 §4): deletes the jobs older than 30 days and, for those whose file was not removed by a commit,
 * their upload (a `failed` job keeps its file until now). Returns how many; a full batch means call again.
 */
export class PurgeImports {
  constructor(
    private readonly files: Pick<FilesApi, 'remove'>,
    private readonly jobs: ImportJobRepository,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  execute(buildingId: string): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - RETENTION_DAYS * 86_400_000)
    return this.uow.run(async () => {
      const purged = await this.jobs.purge(scopeOf(buildingId), cutoff, IMPORT_BATCH_SIZE)
      for (const job of purged.filter(({ status }) => status !== 'committed'))
        try {
          await this.files.remove(systemFileActor(buildingId), job.fileId)
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error
        }
      return purged.length
    })
  }
}
