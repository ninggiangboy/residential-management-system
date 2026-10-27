import type { Database } from '@core/db'
import type { UploadRateLimiter } from '../../application/ports'
import { takeToken } from '../persistence/sql-token-bucket'

/** The bucket `upload:account:<id>` in `platform.rate_bucket`, 60 per hour (DR-64, DOC-17 §3.4). */
export class SqlUploadRateLimiter implements UploadRateLimiter {
  constructor(
    private readonly database: Database,
    private readonly perHour: number,
  ) {}

  take(accountId: string): Promise<void> {
    return takeToken(
      this.database,
      `upload:account:${accountId}`,
      'upload',
      this.perHour,
      this.perHour / 3600,
    )
  }
}
