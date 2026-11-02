import type { Clock } from '@core/kernel'
import { NotFoundError, requireRole } from '@core/kernel'
import type { IdentityApi } from '@mod/identity/contracts'
import type { Language, StaffContext, StaffRole } from '@rms/shared-types'
import {
  type CommittedCounts,
  committedOf,
  type ImportJobRecord,
  type ImportKind,
  type StoredImportStatus,
  statusAt,
} from '../../domain/import-job'
import type {
  ImportJobCursor,
  ImportJobRepository,
  ImportJobSummary,
} from '../../domain/import-job-repository'
import type { TemplateWriter } from '../ports'

/** The Manager's and the Admin's alone (DOC-27 §3.3). The routes read the same list for their guard and audience. */
export const IMPORT_READ_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface ImportListQuery {
  kind: ImportKind
  status?: StoredImportStatus
  after?: ImportJobCursor
  limit: number
}

export interface ImportListItem extends Omit<ImportJobSummary, 'status'> {
  status: StoredImportStatus
  createdByName: string | null
}

export interface ImportList {
  items: ImportListItem[]
  /** The cursor of the last item when there is a next page. */
  next: ImportJobCursor | null
}

/**
 * The reads of the units-and-owners import (E-71, E-73, E-169; DOC-27 §9): the template, one job with the status the clock gives
 * it, and the history list. No state change and no rule of its own (DOC-12 §4.5 rule 3).
 */
export class ImportQueries {
  constructor(
    private readonly jobs: ImportJobRepository,
    private readonly templates: TemplateWriter,
    private readonly identity: Pick<IdentityApi, 'getStaff'>,
    private readonly clock: Clock,
  ) {}

  /** E-71: the workbook in memory; no file is stored. */
  template(staff: StaffContext, language: Language): Promise<Uint8Array> {
    requireRole(staff, IMPORT_READ_ROLES)
    return this.templates.write(language)
  }

  /** E-73: another building's job is 404 like an unknown id. A `validated` job past `expires_at` reads `expired` at once. */
  async get(
    staff: StaffContext,
    id: string,
  ): Promise<{ job: ImportJobRecord; committed: CommittedCounts | null }> {
    requireRole(staff, IMPORT_READ_ROLES)
    const stored = await this.jobs.find(staff.scope, id)
    if (!stored) throw new NotFoundError()
    const status = statusAt(stored, this.clock.now())
    const job = { ...stored, status }
    return { job, committed: status === 'committed' ? committedOf(job.result.counts) : null }
  }

  /** The names of the creators of a page of another kind's jobs (E-169), from one `getStaff` call. */
  async staffNames(
    staff: StaffContext,
    staffIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    requireRole(staff, IMPORT_READ_ROLES)
    if (staffIds.length === 0) return new Map()
    const rows = await this.identity.getStaff([...new Set(staffIds)])
    return new Map(rows.map((row) => [row.staffId, row.fullName]))
  }

  /** E-169: newest first, the creators' names from one `getStaff` call per page. */
  async list(staff: StaffContext, query: ImportListQuery): Promise<ImportList> {
    requireRole(staff, IMPORT_READ_ROLES)
    const now = this.clock.now()
    const rows = await this.jobs.list(staff.scope, { ...query, now })
    const page = rows.slice(0, query.limit)
    const names = new Map(
      (await this.identity.getStaff([...new Set(page.map((row) => row.createdBy))])).map((row) => [
        row.staffId,
        row.fullName,
      ]),
    )
    const last = page.at(-1)
    return {
      items: page.map((row) => ({
        ...row,
        status: statusAt(row, now),
        createdByName: names.get(row.createdBy) ?? null,
      })),
      next: rows.length > query.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    }
  }
}
