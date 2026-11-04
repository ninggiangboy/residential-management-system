import type { JobDefinition } from '@core/runtime'
import type {
  FeeNoticeRunOutcome,
  RunFeeNoticeJob,
} from '../../application/use-cases/run-fee-notice-job'
import type { LedgerCheckBuildings } from './invariant-check'

/** Every 5 s (DOC-38 §4.1, DR-120); the schedule of `fee_notice_run` in the catalog. */
const SCHEDULE_SECONDS = 5

/**
 * `fee_notice_run` (DOC-34 §9.2, DOC-38 §4.1; DR-120, DR-294): every 5 s in `claim` mode, over the real buildings the
 * nightly check covers (`LedgerCheckBuildings`, DR-244). One building loops its claimable jobs until `idle`; the details
 * count each outcome. A render and a bucket call stay outside any transaction (DOC-12 §8.2).
 */
export function feeNoticeRunJob(
  run: RunFeeNoticeJob,
  buildings: LedgerCheckBuildings,
): JobDefinition {
  return {
    name: 'fee_notice_run',
    schedule: { kind: 'every', seconds: SCHEDULE_SECONDS },
    mode: 'claim',
    graceMinutes: 0,
    run: async (ctx) => {
      const buildingIds = await buildings.liveBuildingIds()
      const counts: Record<FeeNoticeRunOutcome, number> = {
        idle: 0,
        ready: 0,
        failed: 0,
        lost_lease: 0,
        aborted: 0,
      }
      for (const buildingId of buildingIds) {
        for (;;) {
          if (ctx.signal.aborted) break
          const { outcome } = await run.execute({ buildingId, signal: ctx.signal })
          counts[outcome] += 1
          if (outcome !== 'ready' && outcome !== 'failed') break
        }
        if (ctx.signal.aborted) break
      }
      ctx.logger.info({ buildings: buildingIds.length, ...counts }, 'fee_notice_run.done')
      return { did: counts.ready + counts.failed, details: counts }
    },
  }
}
