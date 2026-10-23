import type { Clock } from '@core/kernel'
import type { FileActor } from '../../contracts'
import { FileNotVerifiedError, FilesTransactionError } from '../../domain/errors'
import type { FileRepository } from '../../domain/file-repository'
import type { TransactionProbe } from '../ports'
import { scopeOf } from '../scope-of'

/** `FilesApi.attach` (DOC-37 §6.4): the owner's transaction attaches a verified file to its owner, the file decides and one conditional `UPDATE` applies it. */
export class AttachFile {
  constructor(
    private readonly files: FileRepository,
    private readonly clock: Clock,
    private readonly transaction: TransactionProbe,
  ) {}

  async execute(actor: FileActor, fileId: string, ownerRef: string): Promise<void> {
    const { files, clock, transaction } = this
    if (!transaction.inTransaction)
      throw new FilesTransactionError('FilesApi.attach must be called inside the owner transaction')
    const scope = scopeOf(actor.buildingId)
    const now = clock.now()
    const file = await files.find(scope, fileId)
    const change = file?.attach(ownerRef, actor, now)
    const done = change ? await files.apply(scope, change, now) : null
    // Not verified, someone else's, or attached already: the owner's transaction rolls back (DOC-37 §6.4).
    if (!done) throw new FileNotVerifiedError('not_verified')
  }
}
