import type { Database } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { sql } from 'drizzle-orm'
import type { TermsRepository, TermsVersionRecord } from '../../domain/terms-repository'

type Row = { id: string; kind: TermsVersionRecord['kind']; version: number }

/**
 * The statements of DOC-35 §9 and DOC-17 §1.4, written as SQL because each is one set-based statement that the design ran and
 * measured (the gate reads `uq_terms_version_building_kind_version` and `pk_terms_acceptance`).
 */
export class DrizzleTermsRepository implements TermsRepository {
  constructor(private readonly database: Database) {}

  async missing(scope: BuildingScope, accountId: string): Promise<Row[]> {
    return [
      ...(await this.database.executor.execute<Row>(sql`
        SELECT v.id, v.kind, v.version
          FROM (SELECT DISTINCT ON (kind) id, kind, version
                  FROM building.terms_version WHERE building_id = ${scope.buildingId}
                 ORDER BY kind, version DESC) v
         WHERE NOT EXISTS (SELECT 1 FROM building.terms_acceptance a
                            WHERE a.account_id = ${accountId} AND a.version_id = v.id)
         ORDER BY v.kind`)),
    ]
  }

  async latest(scope: BuildingScope): Promise<Row[]> {
    return [
      ...(await this.database.executor.execute<Row>(sql`
        SELECT DISTINCT ON (kind) id, kind, version
          FROM building.terms_version WHERE building_id = ${scope.buildingId}
         ORDER BY kind, version DESC`)),
    ]
  }

  async insertNext(
    scope: BuildingScope,
    row: { id: string; kind: string; text: unknown; publishedBy: string },
  ): Promise<number> {
    const rows = await this.database.executor.execute<{ version: number }>(sql`
      INSERT INTO building.terms_version (id, building_id, kind, version, text, published_by)
      SELECT ${row.id}, ${scope.buildingId}, ${row.kind}, coalesce(max(version), 0) + 1,
             ${JSON.stringify(row.text)}::jsonb, ${row.publishedBy}
        FROM building.terms_version WHERE building_id = ${scope.buildingId} AND kind = ${row.kind}
      RETURNING version`)
    return Number(rows[0]?.version)
  }

  /** DOC-35 §9.3: only the latest version of its kind, and only once; a second call inserts nothing. */
  async accept(
    scope: BuildingScope,
    row: { accountId: string; versionId: string; ip: string | null; appVersion: string | null },
  ): Promise<boolean> {
    const rows = await this.database.executor.execute(sql`
      INSERT INTO building.terms_acceptance (building_id, account_id, version_id, ip, app_version)
      SELECT v.building_id, ${row.accountId}, v.id, ${row.ip}::inet, ${row.appVersion}
        FROM building.terms_version v
       WHERE v.id = ${row.versionId} AND v.building_id = ${scope.buildingId}
         AND v.version = (SELECT max(version) FROM building.terms_version
                           WHERE building_id = v.building_id AND kind = v.kind)
      ON CONFLICT (account_id, version_id) DO NOTHING
      RETURNING version_id`)
    return rows.length === 1
  }

  async isAccepted(scope: BuildingScope, accountId: string, versionId: string): Promise<boolean> {
    const rows = await this.database.executor.execute(sql`
      SELECT 1 FROM building.terms_acceptance
       WHERE building_id = ${scope.buildingId} AND account_id = ${accountId} AND version_id = ${versionId}`)
    return rows.length > 0
  }

  async exists(scope: BuildingScope, versionId: string): Promise<boolean> {
    const rows = await this.database.executor.execute(sql`
      SELECT 1 FROM building.terms_version WHERE building_id = ${scope.buildingId} AND id = ${versionId}`)
    return rows.length > 0
  }
}
