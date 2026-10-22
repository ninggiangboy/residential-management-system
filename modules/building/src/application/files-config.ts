import type { FileLimits } from '../domain/purposes'

export interface FilesConfig {
  /** The profile that starts every object key: `local`, `staging`, `production`, `test`. */
  env: string
  uploadUrlTtlSeconds: number
  downloadUrlTtlSeconds: number
  paperUrlTtlSeconds: number
  limits: FileLimits
  thumbnailWidth: number
  logoWidth: number
  orphanAfterHours: number
  deletedRowRetentionDays: number
}
