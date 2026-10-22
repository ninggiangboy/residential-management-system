import type { Clock, UnitOfWork } from '@core/kernel'
import { NotFoundError } from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { FileActor, FileDto } from '../../contracts'
import { FileNotVerifiedError, FilesTransactionError } from '../../domain/errors'
import type { FileObject, ObjectFailure } from '../../domain/file-object'
import type { FileRepository } from '../../domain/file-repository'
import { HEAD_BYTES } from '../../domain/magic-bytes'
import { deleteCommand, thumbnailCommand } from '../file-commands'
import { toFileDto } from '../file-dto'
import type { FilesConfig } from '../files-config'
import type { ObjectStore, TransactionProbe } from '../ports'
import { scopeOf } from '../scope-of'

export interface VerifyFileDeps {
  files: FileRepository
  store: ObjectStore
  uow: UnitOfWork
  transaction: TransactionProbe
  outbox: OutboxWriter
  clock: Clock
  config: FilesConfig
}

/**
 * `FilesApi.verify` (DOC-37 §6.3): the object is there, has the registered size and type and starts with the right bytes.
 * Nothing is trusted until then. It talks to the bucket, so no transaction may be open while it runs (DOC-12 §8.2).
 */
export class VerifyFile {
  constructor(private readonly deps: VerifyFileDeps) {}

  async execute(actor: FileActor, fileId: string): Promise<FileDto> {
    const { files, store, uow, outbox, clock, transaction } = this.deps
    if (transaction.inTransaction)
      throw new FilesTransactionError('FilesApi.verify must be called outside a transaction')
    const scope = scopeOf(actor.buildingId)
    const file = await files.find(scope, fileId)
    if (!file?.isOwnedBy(actor)) throw new NotFoundError()
    // A retry after a lost response answers the same 200 without touching the bucket (DR-146).
    if (file.status === 'verified') return toFileDto(file)
    if (file.status !== 'pending') throw new NotFoundError()

    const head = await store.head(file.objectKey)
    // Not there yet: the row stays pending so the client can retry inside the window.
    if (!head) throw new FileNotVerifiedError('missing')

    const failure = await this.inspect(file, head)

    const now = clock.now()
    if (failure) {
      // The object is deleted by the worker, not by this request (DOC-37 §6.3 step 6).
      await uow.run(async () => {
        const deleted = await files.markDeleted(scope, file.id, now)
        if (deleted) await outbox.add([deleteCommand(deleted, now)])
      })
      throw new FileNotVerifiedError(failure)
    }
    const verified = await uow.run(async () => {
      const row = await files.markVerified(scope, file.id, head.size, now)
      if (row?.wantsThumbnailOnVerify()) await outbox.add([thumbnailCommand(row, now)])
      return row
    })
    // Lost a race with the orphan job or a double click that verified first: read the row again.
    const current = verified ?? (await files.find(scope, file.id))
    if (current?.status !== 'verified') throw new NotFoundError()
    return toFileDto(current)
  }

  /** Steps 3 and 4 of DOC-37 §6.3: the size and type of the object, then the first 4 KB. `null` when the file passes. */
  private async inspect(
    file: FileObject,
    head: { size: number; contentType: string },
  ): Promise<ObjectFailure | null> {
    const { config, store } = this.deps
    const failure = file.inspectObject(head, config.limits)
    if (failure) return failure
    const bytes = await store.readHead(file.objectKey, HEAD_BYTES)
    if (!bytes) throw new FileNotVerifiedError('missing')
    return file.inspectContent(bytes)
  }
}
