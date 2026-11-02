import {
  type Clock,
  type IdGenerator,
  type Log,
  NotFoundError,
  requireRole,
  type UnitOfWork,
} from '@core/kernel'
import type { FilesApi } from '@mod/building/contracts'
import { type MetricsPort, NO_METRICS, type StaffContext, type StaffRole } from '@rms/shared-types'
import { InvalidTransitionError } from '../../domain/errors'
import type { FeeBatchRepository } from '../../domain/fee-batch-repository'
import { TooManyRowsError } from '../../domain/fee-import/errors'
import { type FeeImportJobRecord, IMPORT_TTL_MS } from '../../domain/fee-import/job'
import type { FeeImportRepository } from '../../domain/fee-import-repository'
import type { FeeImportPlanner } from '../fee-import-planner'
import { fileActorOf } from '../file-actor'

/** The Manager's and the Admin's (DOC-21 §2.3, DOC-27 §3.3). */
export const VALIDATE_FEE_IMPORT_ROLES = [
  'admin',
  'manager',
] as const satisfies readonly StaffRole[]

export interface ValidateFeeImportInput {
  readonly batchId: string
  readonly fileId: string
  readonly fileName?: string
}

/** The name the browser reported, without control characters; blank is no name (DR-258). */
const cleanName = (name: string | undefined) =>
  name
    ?.replace(/\p{Cc}/gu, '')
    .trim()
    .slice(0, 255) || null

/**
 * `POST /staff/imports` with `kind = fee_batch` (E-72, DOC-21 §4.1): the batch must be a draft of the building (else 409
 * `invalid_transition`, or 404 for an unknown or another building's batch, and no job, IM-64); the verified upload is read
 * outside any transaction, the file, row and set layers run in memory, one `findUnitsByCodes` call answers the `db` layer, and
 * the preview is stored as an `import_job`. A file with a `fail` rule makes a `failed` job; more than 5,000 rows is a 400 and
 * stores nothing (DQ-05). The job and the attachment of the file commit together; nothing is written to the batch.
 */
export class ValidateFeeImport {
  constructor(
    private readonly files: Pick<FilesApi, 'read' | 'attach'>,
    private readonly planner: FeeImportPlanner,
    private readonly jobs: FeeImportRepository,
    private readonly batches: Pick<FeeBatchRepository, 'find'>,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly logger: Log,
    private readonly metrics: MetricsPort = NO_METRICS,
  ) {}

  async execute(staff: StaffContext, input: ValidateFeeImportInput): Promise<FeeImportJobRecord> {
    requireRole(staff, VALIDATE_FEE_IMPORT_ROLES)
    const began = performance.now()
    const batch = await this.batches.find(staff.scope, input.batchId)
    if (!batch) throw new NotFoundError()
    if (batch.status !== 'draft')
      throw new InvalidTransitionError('fee_batch', batch.status, 'import')
    const actor = fileActorOf(staff)
    const bytes = await this.files.read(actor, input.fileId, {
      module: 'finance',
      purpose: 'import',
    })

    const read = await this.planner.read(bytes, batch.feeMonth)
    if (read.kind === 'too_many_rows') throw new TooManyRowsError()
    const preview =
      read.kind === 'failed' ? read.preview : (await this.planner.plan(staff.scope, read)).preview
    const now = this.clock.now()
    const job = {
      id: this.ids.next(),
      status: read.kind === 'failed' ? ('failed' as const) : ('validated' as const),
      fileId: input.fileId,
      fileName: cleanName(input.fileName),
      batchId: batch.id,
      result: preview,
      createdBy: staff.staffId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + IMPORT_TTL_MS),
    }
    await this.uow.run(async () => {
      await this.jobs.insertJob(staff.scope, job)
      await this.files.attach(actor, input.fileId, `import:${job.id}`)
    })
    const ms = performance.now() - began
    // NFR-12: 2,000 rows in 10 s; the figure is the whole call, the file read included (DOC-21 §4.6, §7).
    this.metrics.observe('import_validate_duration_seconds', ms / 1000)
    const { rows, valid, errors } = preview.counts
    this.logger.info(
      {
        event: 'fee_import.validated',
        kind: 'fee_batch',
        buildingId: staff.buildingId,
        batchId: batch.id,
        actor: staff.staffId,
        rows,
        valid,
        errors,
        ms: Math.round(ms),
      },
      'fee import validated',
    )
    return { ...job, kind: 'fee_batch', buildingId: staff.buildingId, committedAt: null }
  }
}
