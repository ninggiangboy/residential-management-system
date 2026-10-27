import type { Database } from '@core/db'
import { sql } from 'drizzle-orm'
import type { PiiKeyReader } from '../../domain/pii-key-reader'

/** A blob is `v1:<key id>:<iv>:<ciphertext>` (`SecretBox`); the key id is the second part. */
export class DrizzlePiiKeyReader implements PiiKeyReader {
  constructor(private readonly database: Database) {}

  // scope-ok: the boot guard looks across buildings by design (DOC-36 §10.1 check 6)
  async keyIds(): Promise<string[]> {
    const rows = await this.database.executor.execute<{ kid: string }>(sql`
      SELECT DISTINCT split_part(cccd_enc, ':', 2) AS kid FROM residency.resident_profile WHERE cccd_enc IS NOT NULL`)
    return rows.map((row) => row.kid)
  }
}
