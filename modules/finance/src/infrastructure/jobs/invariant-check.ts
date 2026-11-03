import type { JobDefinition } from '@core/runtime'
import {
  INVARIANT_QUERY_TAGS,
  type InvariantFinding,
  type InvariantReader,
} from '../../domain/invariant-check'

/** The buildings the nightly check covers: every real building, no demo one (DOC-40 §4 rule 4, BD-36). */
export interface LedgerCheckBuildings {
  liveBuildingIds(): Promise<readonly string[]>
}

/**
 * `invariant_check`, daily at 03:00 building time, mode `snapshot` (DOC-38 §4.1, DOC-22 §12, NFR-09): the nineteen queries for
 * each real building (DR-244) in the one `REPEATABLE READ READ ONLY` transaction of `ctx.snapshot`, so a payment that commits
 * during the run cannot show as a violation (LG-58). It **reports and never repairs**: the job succeeds when it finds rows. The
 * count goes to `details.violations`, which is what the gauge `ledger_invariant_violations` reads (DOC-40 §4.2); the first 50
 * ids of each non-empty query go to the log, with the building and the query tag and no amount or name (DOC-22 §14).
 *
 * A run that is stopped half way throws instead of returning a smaller number: a run that checked only some buildings must not
 * look like a clean night.
 */
export function invariantCheckJob(
  reader: InvariantReader,
  buildings: LedgerCheckBuildings,
  graceMinutes: number,
): JobDefinition {
  return {
    name: 'invariant_check',
    schedule: { kind: 'daily', at: '03:00' },
    mode: 'snapshot',
    graceMinutes,
    run: async (ctx) => {
      const buildingIds = await buildings.liveBuildingIds()
      const { violations, perQuery } = await ctx.snapshot(async () => {
        const perQuery: Record<string, number> = {}
        let violations = 0
        for (const buildingId of buildingIds) {
          if (ctx.signal.aborted)
            throw new Error('invariant_check stopped before every building was checked')
          const findings: readonly InvariantFinding[] = await reader.check(buildingId)
          for (const finding of findings) {
            violations += finding.rows
            perQuery[finding.tag] = (perQuery[finding.tag] ?? 0) + finding.rows
            ctx.logger.warn(
              {
                buildingId,
                query: finding.tag,
                rows: finding.rows,
                ids: finding.sampleIds,
              },
              'invariant_check.violation',
            )
          }
        }
        return { violations, perQuery }
      })
      ctx.logger.info(
        { buildings: buildingIds.length, violations, perQuery },
        'invariant_check.done',
      )
      return {
        did: buildingIds.length,
        details: {
          queries: INVARIANT_QUERY_TAGS.length,
          violations,
          buildings: buildingIds.length,
          perQuery,
        },
      }
    },
  }
}
