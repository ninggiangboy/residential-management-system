import type { FeeImportApi, FeeImportJobDto, FeeImportSummaryDto } from '../../contracts'
import type { FeeImportJobRecord } from '../../domain/fee-import/job'
import type { FeeImportJobSummary } from '../../domain/fee-import-repository'
import type { FeeImportQueries } from '../queries/fee-import-queries'
import type { CommitFeeImport } from '../use-cases/commit-fee-import'
import type { ValidateFeeImport } from '../use-cases/validate-fee-import'

const summaryOf = (job: FeeImportJobSummary): FeeImportSummaryDto => ({
  importId: job.id,
  status: job.status,
  fileName: job.fileName,
  batchId: job.batchId,
  createdBy: job.createdBy,
  createdAt: job.createdAt.toISOString(),
  expiresAt: job.expiresAt.toISOString(),
  committedAt: job.committedAt?.toISOString() ?? null,
  counts: job.counts,
})

const jobOf = (job: FeeImportJobRecord): FeeImportJobDto => {
  const { committed, ...preview } = job.result
  const { counts: _counts, ...summary } = summaryOf({ ...job, counts: preview.counts })
  return { ...summary, committed: job.status === 'committed' ? (committed ?? null) : null, preview }
}

/** `FeeImportApi` (DR-149): the use cases and the query service behind the host's import routes, as DTOs; no rule of its own. */
export class FeeImportApiImpl implements FeeImportApi {
  constructor(
    private readonly validateImport: ValidateFeeImport,
    private readonly commitImport: CommitFeeImport,
    private readonly queries: FeeImportQueries,
  ) {}

  template: FeeImportApi['template'] = (staff, language) => this.queries.template(staff, language)

  validate: FeeImportApi['validate'] = async (staff, input) =>
    jobOf(await this.validateImport.execute(staff, input))

  get: FeeImportApi['get'] = async (staff, id) => jobOf(await this.queries.get(staff, id))

  commit: FeeImportApi['commit'] = async (staff, id) => {
    const { job, committed } = await this.commitImport.execute(staff, id)
    return { job: { ...jobOf(job), committed }, committed }
  }

  list: FeeImportApi['list'] = async (staff, query) => {
    const page = await this.queries.list(staff, query)
    return { items: page.items.map(summaryOf), next: page.next }
  }
}
