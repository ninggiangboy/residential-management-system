import type { JobDefinition } from '@core/runtime'
import type { IdentityApi } from '@mod/identity/contracts'
import {
  INTEGRITY_SAMPLE_LIMIT,
  type IntegrityFinding,
  type IntegrityReader,
  type MembershipAccountRef,
} from '../../domain/integrity-check'
import { chunks } from '../persistence/chunks'

/** The buildings the weekly check covers: every real building, no demo one (DOC-40 §4 rule 4). */
export interface IntegrityBuildings {
  liveBuildingIds(): Promise<readonly string[]>
}

/** What the job asks of `identity`: the accounts named by memberships (500 ids at most per call). */
export type IntegrityAccounts = Pick<IdentityApi, 'getResidentAccounts'>

/**
 * `integrity_weekly`, Monday 03:30, mode `snapshot` (DOC-38 §4.1, DR-62, DR-120, DR-321): for each real building it looks for a
 * unit with two owners, a membership of a missing unit, a membership whose account is `deleted`, and a membership whose account is
 * not there at all. It **reports and never repairs**: the job succeeds when it finds rows, each finding is a Warning log line with
 * its `kind`, and `details.findings` (the gauge `integrity_findings`, DOC-40 §4.2) is the number of offending rows.
 *
 * The rows of `residency` are read in the one `REPEATABLE READ READ ONLY` transaction of `ctx.snapshot`. The accounts live in
 * another schema and are read through `IdentityApi` (ADR-0014) after it, so an account deleted during the run may show as a finding
 * that the next run will not repeat. A run that is stopped half way throws instead of returning a smaller number.
 */
export function integrityWeeklyJob(
  reader: IntegrityReader,
  buildings: IntegrityBuildings,
  accounts: IntegrityAccounts,
  graceMinutes: number,
): JobDefinition {
  return {
    name: 'integrity_weekly',
    schedule: { kind: 'weekly', day: 'mon', at: '03:30' },
    mode: 'snapshot',
    graceMinutes,
    run: async (ctx) => {
      const buildingIds = await buildings.liveBuildingIds()
      const perKind: Record<string, number> = {}
      let findings = 0
      const report = (buildingId: string, found: readonly IntegrityFinding[]) => {
        for (const finding of found) {
          findings += finding.rows
          perKind[finding.kind] = (perKind[finding.kind] ?? 0) + finding.rows
          ctx.logger.warn(
            { buildingId, kind: finding.kind, rows: finding.rows, ids: finding.sampleIds },
            'integrity_weekly.finding',
          )
        }
      }
      const read = await ctx.snapshot(async () => {
        const perBuilding: {
          buildingId: string
          found: readonly IntegrityFinding[]
          refs: readonly MembershipAccountRef[]
        }[] = []
        for (const buildingId of buildingIds) {
          if (ctx.signal.aborted)
            throw new Error('integrity_weekly stopped before every building was checked')
          perBuilding.push({
            buildingId,
            found: await reader.checkMemberships(buildingId),
            refs: await reader.liveMembershipAccounts(buildingId),
          })
        }
        return perBuilding
      })
      for (const { buildingId, found, refs } of read) {
        if (ctx.signal.aborted)
          throw new Error('integrity_weekly stopped before every building was checked')
        report(buildingId, [...found, ...(await accountFindings(accounts, refs))])
      }
      ctx.logger.info({ buildings: buildingIds.length, findings, perKind }, 'integrity_weekly.done')
      return {
        did: buildingIds.length,
        details: { findings, buildings: buildingIds.length, perKind },
      }
    },
  }
}

/** `member_of_removed_account` (the account is `deleted`) and `dangling_reference` (no such account); the sample ids are membership ids. */
async function accountFindings(
  accounts: IntegrityAccounts,
  refs: readonly MembershipAccountRef[],
): Promise<IntegrityFinding[]> {
  const byAccount = new Map<string, string[]>()
  for (const ref of refs)
    byAccount.set(ref.accountId, [...(byAccount.get(ref.accountId) ?? []), ref.membershipId])
  const deleted: string[] = []
  const missing: string[] = []
  for (const batch of chunks([...byAccount.keys()])) {
    const found = new Map(
      (await accounts.getResidentAccounts([...batch])).map((account) => [
        account.accountId,
        account,
      ]),
    )
    for (const accountId of batch) {
      const memberships = byAccount.get(accountId) ?? []
      const account = found.get(accountId)
      if (!account) missing.push(...memberships)
      else if (account.status === 'deleted') deleted.push(...memberships)
    }
  }
  const out: IntegrityFinding[] = []
  const add = (kind: IntegrityFinding['kind'], ids: readonly string[]) => {
    if (ids.length > 0)
      out.push({ kind, rows: ids.length, sampleIds: ids.slice(0, INTEGRITY_SAMPLE_LIMIT) })
  }
  add('member_of_removed_account', deleted)
  add('dangling_reference', missing)
  return out
}
