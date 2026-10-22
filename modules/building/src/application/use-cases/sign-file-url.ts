import type { FileRepository } from '../../domain/file-repository'
import type { FilesConfig } from '../files-config'
import type { ObjectStore } from '../ports'
import { scopeOf } from '../scope-of'

export interface SignFileUrlDeps {
  files: FileRepository
  store: ObjectStore
  config: FilesConfig
}

/** `FilesApi.signedUrl` (DOC-37 §8): presigns a `GET` locally; `null` for an unknown or `deleted` file. */
export class SignFileUrl {
  constructor(private readonly deps: SignFileUrlDeps) {}

  async execute(
    fileId: string,
    opts: { variant?: 'original' | 'thumb'; downloadName?: string } = {},
  ): Promise<string | null> {
    const { files, store, config } = this.deps
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
