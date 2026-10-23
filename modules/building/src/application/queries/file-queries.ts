import type { FileRepository } from '../../domain/file-repository'
import type { BuildingDirectory } from '../directory'
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
}
