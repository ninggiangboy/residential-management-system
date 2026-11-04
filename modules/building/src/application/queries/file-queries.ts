import { NotFoundError } from '@core/kernel'
import type { FileActor, FileDto, FileExpectation, FindByOwnerRefInput } from '../../contracts'
import { FileNotVerifiedError } from '../../domain/errors'
import type { FileRepository } from '../../domain/file-repository'
import type { BuildingDirectory } from '../directory'
import { toFileDto } from '../file-dto'
import type { FilesConfig } from '../files-config'
import type { ObjectStore } from '../ports'
import { scopeOf } from '../scope-of'

/** The reads of the files: usage against the quota and presigned `GET` urls. No state change, no rule of its own (DOC-12 §4.5 rule 3). */
export class FileQueries {
  constructor(
    private readonly files: FileRepository,
    private readonly directory: BuildingDirectory,
    private readonly store: ObjectStore,
    private readonly config: FilesConfig,
  ) {}

  /** `FilesApi.read`: the object's bytes once the row says the caller may have them. */
  async read(actor: FileActor, fileId: string, expect: FileExpectation): Promise<Uint8Array> {
    const file = await this.files.find(scopeOf(actor.buildingId), fileId)
    if (!file) throw new NotFoundError()
    const verified = file.status === 'verified'
    const attached = file.status === 'attached' && expect.ownerRef !== undefined
    // A `verified` file is the registering account's alone; an `attached` one is the owner's, named by `ownerRef`.
    if (verified && !file.isOwnedBy(actor)) throw new NotFoundError()
    const usable = verified || (attached && file.ownerRef === expect.ownerRef)
    if (!usable || file.purpose !== expect.purpose || file.module !== expect.module)
      throw new FileNotVerifiedError('not_verified')
    const bytes = await this.store.read(file.objectKey)
    if (!bytes) throw new FileNotVerifiedError('missing')
    return bytes
  }

  /** `FilesApi.usage` (DOC-37 §11): the bytes of the live files of a building against its quota. */
  async usage(buildingId: string) {
    const [usedBytes, settings] = await Promise.all([
      this.files.usedBytes(scopeOf(buildingId)),
      this.directory.getSettings(buildingId),
    ])
    const quotaBytes = settings.storageQuotaBytes
    return { usedBytes, quotaBytes, ratio: usedBytes / quotaBytes }
  }

  /** `FilesApi.signedUrl` (DOC-37 §8): presigns a `GET` locally; `null` for an unknown or `deleted` file. */
  async signedUrl(
    fileId: string,
    opts: { variant?: 'original' | 'thumb'; downloadName?: string } = {},
  ): Promise<string | null> {
    const { files, store, config } = this
    // The module that builds a DTO has authorised the file already; FilesApi does not authorise (DOC-37 §8).
    const file = await files.findAnyBuilding(fileId)
    if (!file || file.isDeleted) return null
    let target = file
    if (opts.variant === 'thumb') {
      const thumb = await files.findThumbnail(scopeOf(file.buildingId), file.id)
      if (thumb) target = thumb
    }
    return store.presignGet(target.objectKey, {
      expiresInSeconds: file.hasPaperUrl()
        ? config.paperUrlTtlSeconds
        : config.downloadUrlTtlSeconds,
      downloadName: opts.downloadName,
    })
  }

  /** `FilesApi.findByOwnerRef` (DR-293; DOC-34 §8, DOC-37 §3): the `attached` row a cache wrote, or `null`. No store call. */
  async findByOwnerRef(buildingId: string, input: FindByOwnerRefInput): Promise<FileDto | null> {
    const file = await this.files.findByOwnerRef(scopeOf(buildingId), input)
    return file ? toFileDto(file) : null
  }
}
