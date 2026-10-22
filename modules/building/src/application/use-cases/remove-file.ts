import type { Clock } from '@core/kernel'
import { NotFoundError } from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { FileActor } from '../../contracts'
import { FilesTransactionError } from '../../domain/errors'
import type { FileObject } from '../../domain/file-object'
import type { FileRepository } from '../../domain/file-repository'
import { deleteCommand } from '../file-commands'
import type { TransactionProbe } from '../ports'
import { scopeOf } from '../scope-of'

export interface RemoveFileDeps {
  files: FileRepository
  outbox: OutboxWriter
  clock: Clock
  transaction: TransactionProbe
}

/** `FilesApi.remove`: in the owner's transaction the file and its thumbnail become `deleted`, and a delete command is written per object. */
export class RemoveFile {
  constructor(private readonly deps: RemoveFileDeps) {}

  async execute(actor: FileActor, fileId: string): Promise<void> {
    const { files, outbox, clock, transaction } = this.deps
    if (!transaction.inTransaction)
      throw new FilesTransactionError('FilesApi.remove must be called inside the owner transaction')
    const scope = scopeOf(actor.buildingId)
    const now = clock.now()
    const file = await files.find(scope, fileId)
    if (!file) throw new NotFoundError()
    const targets: FileObject[] = [file]
    const thumbnail = await files.findThumbnail(scope, file.id)
    if (thumbnail) targets.push(thumbnail)
    for (const target of targets) {
      const deleted = await files.markDeleted(scope, target.id, now)
      if (deleted) await outbox.add([deleteCommand(deleted, now)])
    }
  }
}
