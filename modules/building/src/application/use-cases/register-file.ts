import type { Clock, IdGenerator, UnitOfWork } from '@core/kernel'
import type { FileActor, RegisterInput, UploadTicket } from '../../contracts'
import { QuotaExceededError } from '../../domain/errors'
import { FileObject } from '../../domain/file-object'
import type { FileRepository } from '../../domain/file-repository'
import type { BuildingDirectory } from '../directory'
import type { FilesConfig } from '../files-config'
import type { ObjectStore, UploadRateLimiter } from '../ports'
import { scopeOf } from '../scope-of'

export interface RegisterFileDeps {
  files: FileRepository
  store: ObjectStore
  uow: UnitOfWork
  rateLimiter: UploadRateLimiter
  directory: BuildingDirectory
  clock: Clock
  ids: IdGenerator
  config: FilesConfig
}

/**
 * `FilesApi.register` (DOC-37 §6.1): checks the audience, the purpose, the type, the size, the rate bucket and the quota,
 * inserts a `pending` row and presigns the `PUT`. No upload byte passes through the API.
 */
export class RegisterFile {
  constructor(private readonly deps: RegisterFileDeps) {}

  async execute(actor: FileActor, input: RegisterInput): Promise<UploadTicket> {
    const { config, directory, rateLimiter, files, uow, clock, ids, store } = this.deps
    const now = clock.now()
    const id = ids.next()
    const { file, maxBytes } = FileObject.register({
      id,
      actor,
      input,
      env: config.env,
      now,
      limits: config.limits,
    })

    await rateLimiter.take(actor.accountId)

    const scope = scopeOf(actor.buildingId)
    const settings = await directory.getSettings(actor.buildingId)
    const used = await files.usedBytes(scope)
    // Not atomic with the insert: concurrent registers can overshoot by their number times the size; the hourly job corrects (DOC-37 §11).
    if (used + input.size > settings.storageQuotaBytes)
      throw new QuotaExceededError(used, settings.storageQuotaBytes)

    await uow.run(() => files.insert(scope, file, now))
    const expiresInSeconds = config.uploadUrlTtlSeconds
    return {
      fileId: id,
      method: 'PUT',
      url: store.presignPut(file.objectKey, { contentType: input.mime, expiresInSeconds }),
      headers: { 'Content-Type': input.mime },
      expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
      maxBytes,
    }
  }
}
