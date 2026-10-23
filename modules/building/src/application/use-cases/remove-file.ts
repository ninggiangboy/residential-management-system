import type { Clock } from '@core/kernel'
import { NotFoundError } from '@core/kernel'
import type { FileActor } from '../../contracts'
import { FilesTransactionError } from '../../domain/errors'
import type { FileObject } from '../../domain/file-object'
import type { FileRepository } from '../../domain/file-repository'
import type { FileDeleter } from '../file-deleter'
import type { TransactionProbe } from '../ports'
import { scopeOf } from '../scope-of'

/** `FilesApi.remove`: in the owner's transaction the file and its thumbnail become `deleted`, and a delete command is written per object. */
export class RemoveFile {
  constructor(
    private readonly files: FileRepository,
    private readonly deleter: FileDeleter,
    private readonly clock: Clock,
    private readonly transaction: TransactionProbe,
  ) {}

  async execute(actor: FileActor, fileId: string): Promise<void> {
    const { files, deleter, clock, transaction } = this
    if (!transaction.inTransaction)
      throw new FilesTransactionError('FilesApi.remove must be called inside the owner transaction')
    const scope = scopeOf(actor.buildingId)
    const now = clock.now()
    const file = await files.find(scope, fileId)
    if (!file) throw new NotFoundError()
    const targets: FileObject[] = [file]
    const thumbnail = await files.findThumbnail(scope, file.id)
    if (thumbnail) targets.push(thumbnail)
    for (const target of targets) await deleter.delete(scope, target, now)
  }
}
