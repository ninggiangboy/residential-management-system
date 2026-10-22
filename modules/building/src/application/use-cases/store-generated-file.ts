import type { Clock, IdGenerator, UnitOfWork } from '@core/kernel'
import type { FileDto, StoreGeneratedInput } from '../../contracts'
import { FileNotVerifiedError } from '../../domain/errors'
import { FileObject } from '../../domain/file-object'
import type { FileRepository } from '../../domain/file-repository'
import { toFileDto } from '../file-dto'
import type { FilesConfig } from '../files-config'
import type { ObjectStore } from '../ports'
import { scopeOf } from '../scope-of'

export interface StoreGeneratedFileDeps {
  files: FileRepository
  store: ObjectStore
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  config: FilesConfig
}

/** `FilesApi.storeGenerated` (DOC-37 §9): the worker stores a PDF, a ZIP or an export; it bypasses the quota (DR-123). */
export class StoreGeneratedFile {
  constructor(private readonly deps: StoreGeneratedFileDeps) {}

  async execute(input: StoreGeneratedInput): Promise<FileDto> {
    const { files, store, uow, clock, ids, config } = this.deps
    const id = ids.next()
    const file = FileObject.generated({ id, input, env: config.env, now: clock.now() })
    const scope = scopeOf(input.buildingId)
    // Quota is not checked: a receipt must render even when the building is at its limit (DR-123).
    await uow.run(() => files.insert(scope, file, clock.now()))
    // A failure here leaves the row pending; the orphan job removes it after 24 hours (DOC-37 §9 step 4).
    const written = await store.put(file.objectKey, input.body, input.mime)
    const stored = await uow.run(() =>
      files.completeGenerated(
        scope,
        id,
        { size: written.size, checksum: written.sha256 },
        clock.now(),
      ),
    )
    if (!stored) throw new FileNotVerifiedError('not_verified')
    return toFileDto(stored)
  }
}
