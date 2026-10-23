import type { FileRepository } from '../../domain/file-repository'
import type { BuildingDirectory } from '../directory'
import type { UsageReporter } from '../ports'
import { scopeOf } from '../scope-of'

/** `storage_quota` (DOC-37 §11, §14): the usage of one building against its quota; the alert thresholds (0.8 and 1.0) are DOC-40's. */
export class ReportStorageQuota {
  constructor(
    private readonly files: FileRepository,
    private readonly directory: BuildingDirectory,
    private readonly usage: UsageReporter,
  ) {}

  async execute(
    buildingId: string,
  ): Promise<{ usedBytes: number; quotaBytes: number; ratio: number }> {
    const { files, directory, usage } = this
    const [usedBytes, settings, isDemo] = await Promise.all([
      files.usedBytes(scopeOf(buildingId)),
      directory.getSettings(buildingId),
      directory.isDemo(buildingId),
    ])
    const quotaBytes = settings.storageQuotaBytes
    const ratio = usedBytes / quotaBytes
    usage.report(buildingId, ratio, isDemo)
    return { usedBytes, quotaBytes, ratio }
  }
}
