import {
  type Clock,
  type IdGenerator,
  type Log,
  NotFoundError,
  requireRole,
  type UnitOfWork,
} from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { FilesApi } from '@mod/building/contracts'
import { type MetricsPort, NO_METRICS, type StaffContext, type StaffRole } from '@rms/shared-types'
import { InvalidTransitionError } from '../../domain/errors'
import type { DraftChargeInsert } from '../../domain/fee-batch'
import type { FeeBatchRepository } from '../../domain/fee-batch-repository'
import {
  ImportExpiredError,
  ImportIntegrityError,
  ImportNotReadyError,
  ImportStaleError,
} from '../../domain/fee-import/errors'
import { type FeeImportJobRecord, statusAt } from '../../domain/fee-import/job'
import { type FeeImportPlan, sameFeeCounts } from '../../domain/fee-import/plan'
import type { FeeImportCommitted } from '../../domain/fee-import/types'
import type { FeeImportRepository } from '../../domain/fee-import-repository'
import type { FeeImportPlanner } from '../fee-import-planner'
import { fileActorOf } from '../file-actor'

/** The Manager's and the Admin's (DOC-21 §2.3, DOC-35 §4.1). */
export const COMMIT_FEE_IMPORT_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface CommitFeeImportResult {
  readonly job: FeeImportJobRecord
  readonly committed: FeeImportCommitted
}

/**
 * `POST /staff/imports/{id}/commit` for a fee file (E-74, DOC-21 §4.5): the file is read again outside the transaction, then one
 * transaction claims the job, re-runs the layers and the one `findUnitsByCodes` call against the stored counts, locks the batch
 * with `version + 1 … WHERE status = 'draft'`, replaces the draft's charges (those added by hand included) and writes the
 * `finance.batch.import_commit` audit row. A second "Save" finds the job committed and gets the first answer (IM-72).
 */
export class CommitFeeImport {
  private readonly auditedWrite: ReturnType<CommitFeeImport['buildAudited']>

  constructor(
    private readonly files: Pick<FilesApi, 'read'>,
    private readonly planner: FeeImportPlanner,
    private readonly jobs: FeeImportRepository,
    private readonly batches: Pick<FeeBatchRepository, 'find'>,
    audited: Audited,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly logger: Log,
    private readonly metrics: MetricsPort = NO_METRICS,
  ) {
    this.auditedWrite = this.buildAudited(audited)
  }

  /** `import_commits_total{outcome}`: what a refused "Save" came to (DOC-21 §7). */
  private refused<E extends Error>(outcome: 'expired' | 'stale' | 'not_ready', error: E): E {
    this.metrics.inc('import_commits_total', { outcome })
    return error
  }

  async execute(staff: StaffContext, importId: string): Promise<CommitFeeImportResult> {
    requireRole(staff, COMMIT_FEE_IMPORT_ROLES)
    const began = performance.now()
    const now = this.clock.now()
    const job = await this.jobs.findJob(staff.scope, importId)
    if (!job) throw new NotFoundError()
    const answer = this.answerFor(job, now)
    if (answer) return answer
    const batch = await this.batches.find(staff.scope, job.batchId)
    // A discarded draft took its jobs' purpose with it (IM-71).
    if (!batch) throw new NotFoundError()

    const bytes = await this.files.read(fileActorOf(staff), job.fileId, {
      module: 'finance',
      purpose: 'import',
      ownerRef: `import:${job.id}`,
    })
    const read = await this.planner.read(bytes, batch.feeMonth)
    // The job was `validated`, so the file read well then; one that no longer does cannot match its preview.
    if (read.kind !== 'read') throw this.refused('stale', new ImportStaleError(0))

    const result = await this.uow.run(async () => {
      // Step 1, FNM-S08: of two presses of "Save" one claims the job, the other finds it committed.
      const claimed = await this.jobs.claimJob(staff.scope, job.id, now)
      if (!claimed) return this.replay(staff, job.id, now)
      const plan = await this.planner.plan(staff.scope, read)
      if (!sameFeeCounts(plan.preview.counts, claimed.result.counts))
        throw this.refused('stale', new ImportStaleError(plan.preview.counts.rows))
      const committed = await this.auditedWrite(staff, claimed, plan)
      this.metrics.inc('import_commits_total', { outcome: 'committed' })
      return {
        job: claimed,
        committed: { created: committed.created, replaced: committed.replaced },
      }
    })
    this.logger.info(
      {
        event: 'fee_import.committed',
        buildingId: staff.buildingId,
        batchId: job.batchId,
        actor: staff.staffId,
        ms: Math.round(performance.now() - began),
      },
      'fee import committed',
    )
    return result
  }

  /** The answer a job gives without a write: the first result of a committed one, or why it cannot be committed. */
  private answerFor(job: FeeImportJobRecord, now: Date): CommitFeeImportResult | null {
    const status = statusAt(job, now)
    if (status === 'committed')
      return {
        job,
        committed: job.result.committed ?? { created: job.result.counts.charges, replaced: 0 },
      }
    if (status === 'expired') throw this.refused('expired', new ImportExpiredError())
    if (status !== 'validated') throw this.refused('not_ready', new ImportNotReadyError(status))
    return null
  }

  /** The claim found no `validated` row: another request got there first, or the job expired in the meantime. */
  private async replay(staff: StaffContext, id: string, now: Date): Promise<CommitFeeImportResult> {
    const current = await this.jobs.findJob(staff.scope, id)
    if (!current) throw new NotFoundError()
    const answer = this.answerFor(current, now)
    if (!answer) throw this.refused('not_ready', new ImportNotReadyError(current.status))
    return answer
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'finance.batch.import_commit',
        object: (written: FeeImportCommitted & { importId: string }) => ({
          type: 'import_job',
          id: written.importId,
        }),
        details: ({ importId: _importId, ...written }) => ({ ...written }),
      },
      async (staff: StaffContext, job: FeeImportJobRecord, plan: FeeImportPlan) => ({
        result: { importId: job.id, ...(await this.write(staff, job, plan)) },
        changes: [],
      }),
    )
  }

  /** Steps 2 to 4 of DOC-21 §4.5 and the DQ-80 check; any throw rolls back the claim with them. */
  private async write(
    staff: StaffContext,
    job: FeeImportJobRecord,
    plan: FeeImportPlan,
  ): Promise<FeeImportCommitted & { batchId: string; version: number }> {
    const { scope } = staff
    const version = await this.jobs.lockDraftBatch(scope, job.batchId)
    if (version === null) {
      const batch = await this.batches.find(scope, job.batchId)
      if (!batch) throw new NotFoundError()
      throw new InvalidTransitionError('fee_batch', batch.status, 'import_commit')
    }
    const replaced = await this.jobs.deleteDraftCharges(scope, job.batchId)
    const charges: DraftChargeInsert[] = plan.charges.map((charge) => ({
      id: this.ids.next(),
      batchId: job.batchId,
      unitId: charge.unitId,
      unitCode: charge.unitCode,
      amount: charge.amount,
      lines: charge.lines.map((line) => ({ ...line, id: this.ids.next() })),
    }))
    const written = await this.jobs.insertDraftCharges(scope, charges)
    const { counts } = plan.preview
    if (written.charges !== counts.charges || written.lines !== counts.lines)
      throw new ImportIntegrityError(
        `wrote ${written.charges} charges and ${written.lines} lines for ${counts.charges} and ${counts.lines}`,
      )
    const committed = { created: written.charges, replaced }
    await this.jobs.recordCommitted(scope, job.id, committed)
    return { ...committed, batchId: job.batchId, version }
  }
}
