import type { Database } from '@core/db'
import { sql } from 'drizzle-orm'
import {
  INTEGRITY_SAMPLE_LIMIT,
  type IntegrityFinding,
  type IntegrityReader,
  type MembershipAccountRef,
} from '../../domain/integrity-check'

interface IdRow {
  readonly id: string
}

/**
 * The reads of `integrity_weekly` (DR-321). They use the ambient executor like the other repositories and open no transaction: the
 * job owns the `REPEATABLE READ READ ONLY` one (DOC-38 §4). Every query is bound to the one building of the loop.
 */
export class DrizzleIntegrityReader implements IntegrityReader {
  constructor(private readonly database: Database) {}

  async checkMemberships(buildingId: string): Promise<readonly IntegrityFinding[]> {
    const findings: IntegrityFinding[] = []
    // A unit with more than one owner that is not removed. The partial unique index `membership_one_owner_per_unit` forbids it, so
    // a row here means the index was dropped or bypassed. Counted per unit; the sample is the unit ids.
    const twoOwners = (await this.database.executor.execute(sql`
      SELECT m.unit_id::text AS id FROM residency.membership m
       WHERE m.building_id = ${buildingId} AND m.member_type = 'owner' AND m.status <> 'removed'
       GROUP BY m.unit_id HAVING count(*) > 1 ORDER BY m.unit_id`)) as unknown as IdRow[]
    push(findings, 'membership_two_owners', twoOwners)
    // A membership of a unit that does not exist in the building (`fk_membership_unit` forbids it; same reading as above).
    const unitMissing = (await this.database.executor.execute(sql`
      SELECT m.id::text AS id FROM residency.membership m
       WHERE m.building_id = ${buildingId} AND m.status <> 'removed'
         AND NOT EXISTS (SELECT 1 FROM residency.unit u WHERE u.id = m.unit_id AND u.building_id = m.building_id)
       ORDER BY m.id`)) as unknown as IdRow[]
    push(findings, 'membership_unit_missing', unitMissing)
    return findings
  }

  async liveMembershipAccounts(buildingId: string): Promise<readonly MembershipAccountRef[]> {
    const rows = (await this.database.executor.execute(sql`
      SELECT m.id::text AS "membershipId", m.account_id::text AS "accountId" FROM residency.membership m
       WHERE m.building_id = ${buildingId} AND m.status <> 'removed' ORDER BY m.id`)) as unknown as MembershipAccountRef[]
    return rows
  }
}

function push(
  findings: IntegrityFinding[],
  kind: IntegrityFinding['kind'],
  rows: readonly IdRow[],
): void {
  if (rows.length === 0) return
  findings.push({
    kind,
    rows: rows.length,
    sampleIds: rows.slice(0, INTEGRITY_SAMPLE_LIMIT).map((row) => row.id),
  })
}
