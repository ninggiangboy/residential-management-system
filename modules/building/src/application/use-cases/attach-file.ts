import type { Clock } from '@core/kernel'
import type { FileActor } from '../../contracts'
import { FileNotVerifiedError, FilesTransactionError } from '../../domain/errors'
import type { FileRepository } from '../../domain/file-repository'
import type { TransactionProbe } from '../ports'
import { scopeOf } from '../scope-of'

export interface AttachFileDeps {
  files: FileRepository
  clock: Clock
  transaction: TransactionProbe
}

/** `FilesApi.attach` (DOC-37 §6.4): the owner's transaction attaches a verified file to its owner, in one conditional `UPDATE`. */
export class AttachFile {
  constructor(private readonly deps: AttachFileDeps) {}

  async execute(actor: FileActor, fileId: string, ownerRef: string): Promise<void> {
    const { files, clock, transaction } = this.deps
    if (!transaction.inTransaction)
      throw new FilesTransactionError('FilesApi.attach must be called inside the owner transaction')
    const done = await files.attach(
      scopeOf(actor.buildingId),
      { id: fileId, ownerRef, accountKind: actor.accountKind, accountId: actor.accountId },
      clock.now(),
    )
    // Not verified, someone else's, or attached already: the owner's transaction rolls back (DOC-37 §6.4).
    if (!done) throw new FileNotVerifiedError('not_verified')
  }
}
