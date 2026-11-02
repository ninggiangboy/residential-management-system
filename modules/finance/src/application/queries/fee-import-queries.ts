import { type Clock, NotFoundError, requireRole } from '@core/kernel'
import type { Language, StaffContext, StaffRole } from '@rms/shared-types'
import {
  type FeeImportJobRecord,
  type FeeImportStatus,
  statusAt,
} from '../../domain/fee-import/job'
import type {
  FeeImportJobCursor,
  FeeImportJobSummary,
  FeeImportRepository,
} from '../../domain/fee-import-repository'
import type { TemplateWriter } from '../ports'

/** The Manager's and the Admin's (DOC-27 §3.3); the routes read the same list for their guard and audience. */
export const FEE_IMPORT_READ_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface FeeImportListQuery {
  readonly status?: FeeImportStatus
  readonly after?: FeeImportJobCursor
  readonly limit: number
}

export interface FeeImportList {
  readonly items: readonly FeeImportJobSummary[]
  /** The cursor of the last item when there is a next page. */
  readonly next: FeeImportJobCursor | null
}

/**
 * The reads of the fee import (E-71, E-73, E-169 with `kind = fee_batch`): the template, one job with the status the clock gives it, and the history
 * list. No state change and no rule of its own (DOC-12 §4.5 rule 3).
 */
export class FeeImportQueries {
  constructor(
    private readonly jobs: Pick<FeeImportRepository, 'findJob' | 'listJobs'>,
    private readonly templates: TemplateWriter,
    private readonly clock: Clock,
  ) {}

  /** E-71: the workbook in memory; no file is stored. */
  template(staff: StaffContext, language: Language): Promise<Uint8Array> {
    requireRole(staff, FEE_IMPORT_READ_ROLES)
    return this.templates.write(language)
  }

  /** E-73: another building's job is 404 like an unknown id; a `validated` job past `expires_at` reads `expired` at once. */
  async get(staff: StaffContext, id: string): Promise<FeeImportJobRecord> {
    requireRole(staff, FEE_IMPORT_READ_ROLES)
    const job = await this.jobs.findJob(staff.scope, id)
    if (!job) throw new NotFoundError()
    return { ...job, status: statusAt(job, this.clock.now()) }
  }

  /** E-169: newest first, keyset on `(created_at, id)`. */
  async list(staff: StaffContext, query: FeeImportListQuery): Promise<FeeImportList> {
    requireRole(staff, FEE_IMPORT_READ_ROLES)
    const now = this.clock.now()
    const rows = await this.jobs.listJobs(staff.scope, { ...query, now })
    const page = rows.slice(0, query.limit).map((row) => ({ ...row, status: statusAt(row, now) }))
    const last = page.at(-1)
    return {
      items: page,
      next: rows.length > query.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    }
  }
}
