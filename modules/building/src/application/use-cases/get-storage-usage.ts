import type { FileRepository } from '../../domain/file-repository'
import type { BuildingDirectory } from '../directory'
import { scopeOf } from '../scope-of'

export interface GetStorageUsageDeps {
  files: FileRepository
  directory: BuildingDirectory
}

/** `FilesApi.usage` (DOC-37 §11): the bytes of the live files of a building against its quota. */
export class GetStorageUsage {
  constructor(private readonly deps: GetStorageUsageDeps) {}

  async execute(buildingId: string) {
    const [usedBytes, settings] = await Promise.all([
      this.deps.files.usedBytes(scopeOf(buildingId)),
      this.deps.directory.getSettings(buildingId),
    ])
    const quotaBytes = settings.storageQuotaBytes
    return { usedBytes, quotaBytes, ratio: usedBytes / quotaBytes }
  }
}
