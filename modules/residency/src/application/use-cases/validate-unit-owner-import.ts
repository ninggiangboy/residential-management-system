import {
  type Clock,
  type IdGenerator,
  requireRole,
  type UnitOfWork,
  ValidationError,
} from '@core/kernel'
import type { BuildingApi, FilesApi } from '@mod/building/contracts'
import { buildingToday, type StaffContext, type StaffRole } from '@rms/shared-types'
import { IMPORT_TTL_MS, type ImportJobRecord } from '../../domain/import-job'
import type { ImportJobRepository } from '../../domain/import-job-repository'
import { fileActorOf } from '../file-actor'
import type { ImportPlanner } from '../import-planner'

/** The Manager's and the Admin's alone (DOC-27 §3.3). */
export const VALIDATE_UNIT_OWNER_IMPORT_ROLES = [
  'admin',
  'manager',
] as const satisfies readonly StaffRole[]

/**
 * `POST /staff/imports` with `kind = unit_owner` (E-72, DOC-27 §9.1): reads the verified upload, runs the file, row, set and db
 * layers of DOC-18 §1 in memory and stores the preview as an `import_job`. Nothing is written to the units tables. The file is
 * read before the transaction opens (it talks to the bucket, DOC-12 §8.2); the job and the attachment of the file commit
 * together. A file that cannot be read still makes a `failed` job, so the screen can show why; one of more than 5,000 rows is a
 * 400 and stores nothing (DQ-05).
 */
export class ValidateUnitOwnerImport {
  constructor(
    private readonly files: Pick<FilesApi, 'read' | 'attach'>,
    private readonly planner: ImportPlanner,
    private readonly jobs: ImportJobRepository,
    private readonly building: Pick<BuildingApi, 'getBuilding'>,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(staff: StaffContext, input: { fileId: string }): Promise<ImportJobRecord> {
    requireRole(staff, VALIDATE_UNIT_OWNER_IMPORT_ROLES)
    const actor = fileActorOf(staff)
    const bytes = await this.files.read(actor, input.fileId, {
      module: 'residency',
      purpose: 'import',
    })
    const now = this.clock.now()
    const building = await this.building.getBuilding(staff.buildingId)
    const today = buildingToday(now, building?.timeZone ?? 'Asia/Ho_Chi_Minh')

    const read = await this.planner.read(bytes, today)
    if (read.kind === 'too_many_rows')
      throw new ValidationError([
        { path: 'file', code: 'too_many_rows', message: 'The file has more than 5,000 rows' },
      ])
    const preview = read.kind === 'failed' ? read.preview : (await this.plan(staff, read)).preview

    const job = {
      id: this.ids.next(),
      kind: 'unit_owner' as const,
      status: read.kind === 'failed' ? ('failed' as const) : ('validated' as const),
      fileId: input.fileId,
      fileName: null,
      result: preview,
      createdBy: staff.staffId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + IMPORT_TTL_MS),
    }
    await this.uow.run(async () => {
      await this.jobs.insert(staff.scope, job)
      await this.files.attach(actor, input.fileId, `import:${job.id}`)
    })
    return { ...job, buildingId: staff.buildingId, committedAt: null }
  }

  private plan(staff: StaffContext, read: Parameters<ImportPlanner['plan']>[1]) {
    return this.planner.plan(staff.scope, read)
  }
}
