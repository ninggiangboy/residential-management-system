import {
  ForbiddenError,
  NotFoundError,
  PreconditionRequiredError,
  RuleViolationError,
  type UnitOfWork,
  VersionConflictError,
} from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { BuildingId, StaffContext } from '@rms/shared-types'
import type { Bilingual, BuildingSettings, FilesApi, SettingsPatch } from '../contracts'
import {
  assertBuildingPatch,
  type BuildingFields,
  type BuildingPatch,
  diffBuilding,
  patchedFields,
} from '../domain/building-fields'
import { assertPatchInRange, mergeSettings, resolveSettings } from '../domain/settings'
import type { BuildingDirectory } from './directory'
import type {
  BuildingRecord,
  BuildingRepository,
  FileRepository,
  SettingsRepository,
} from './ports'

/** `GET /staff/settings`: the building row and the settings in one document (DOC-36 §4). */
export interface BuildingDocument {
  building: {
    id: string
    code: string
    name: Bilingual
    company: BuildingRecord['company']
    address: string
    hotline: string | null
    workingHours: Bilingual | null
    email: string | null
    logoFileId: string | null
    logoUrl: string | null
    timeZone: string
    isDemo: boolean
  }
  settings: BuildingSettings
  /** The keys an Admin saved; the others are defaults. */
  saved: string[]
  /** `"<building.version>.<building_setting.version>"`, the `ETag` of the document. */
  etag: string
}

export interface UpdateSettingsInput {
  building?: BuildingPatch
  settings?: SettingsPatch
  /** The `If-Match` the client sent: `"3.8"`, or `undefined` when it sent none. */
  etag: string | undefined
}

const etagOf = (building: number, settings: number) => `${building}.${settings}`

/** `3.8` → `[3, 8]`; quotes are the route's, but are tolerated here. */
function parseEtag(etag: string): { building: number; settings: number } | null {
  const match = /^"?(\d+)\.(\d+)"?$/.exec(etag.trim())
  return match ? { building: Number(match[1]), settings: Number(match[2]) } : null
}

const fieldsOf = (record: BuildingRecord): BuildingFields => ({
  name: record.name,
  company: record.company,
  address: record.address,
  hotline: record.hotline,
  workingHours: record.workingHours,
  email: record.email,
  logoFile: record.logoFile,
})

/** Masks of the building's audited fields: contact details of a person or a company line are masked as emails and phones (DOC-35 §3.4). */
const BUILDING_MASKS = {
  email: 'email',
  'company.email': 'email',
  'company.phone': 'phone',
} as const

export interface BuildingSettingsDeps {
  uow: UnitOfWork
  buildings: BuildingRepository
  settings: SettingsRepository
  files: FileRepository
  filesApi: FilesApi
  directory: BuildingDirectory
  audited: Audited
}

/**
 * `GET` and `PATCH /staff/settings` (DOC-36 §4): the Admin edits the building row and the settings in one transaction, each
 * guarded by the version the form read, each with its own audit row; a request that changes one part leaves the other alone.
 */
export class BuildingSettingsService {
  private readonly auditedBuilding: ReturnType<BuildingSettingsService['buildAuditedBuilding']>
  private readonly auditedSettings: ReturnType<BuildingSettingsService['buildAuditedSettings']>

  constructor(private readonly deps: BuildingSettingsDeps) {
    this.auditedBuilding = this.buildAuditedBuilding()
    this.auditedSettings = this.buildAuditedSettings()
  }

  async get(staff: StaffContext): Promise<BuildingDocument> {
    assertAdmin(staff)
    return this.document(staff.buildingId)
  }

  async update(staff: StaffContext, input: UpdateSettingsInput): Promise<BuildingDocument> {
    assertAdmin(staff)
    if (input.etag === undefined) throw new PreconditionRequiredError()
    const versions = parseEtag(input.etag)
    if (input.settings) assertPatchInRange(input.settings)
    if (input.building) assertBuildingPatch(input.building)

    const { uow, directory } = this.deps
    await uow.run(async () => {
      const current = await this.deps.buildings.find(staff.buildingId)
      if (!current) throw new NotFoundError()
      const saved = await this.deps.settings.find(staff.scope)
      // A stale form fails even when nothing raced in between (DOC-12 §9.2).
      const stale =
        !versions ||
        (input.building && versions.building !== current.version) ||
        (input.settings && versions.settings !== (saved?.version ?? 0))
      if (stale) throw new VersionConflictError(await this.document(staff.buildingId))

      if (input.building)
        await this.auditedBuilding(staff, {
          patch: input.building,
          current,
          version: current.version,
        })
      if (input.settings && saved)
        await this.auditedSettings(staff, { patch: input.settings, saved })
      else if (input.settings) throw new NotFoundError()
    })
    directory.invalidate(staff.buildingId)
    return this.document(staff.buildingId)
  }

  private async document(buildingId: string): Promise<BuildingDocument> {
    const { buildings, settings, filesApi } = this.deps
    const record = await buildings.find(buildingId)
    if (!record) throw new NotFoundError()
    const saved = await settings.find({ buildingId: buildingId as BuildingId })
    const data = saved?.data ?? {}
    return {
      building: {
        id: record.id,
        code: record.code,
        name: record.name,
        company: record.company,
        address: record.address,
        hotline: record.hotline,
        workingHours: record.workingHours,
        email: record.email,
        logoFileId: record.logoFile,
        logoUrl: record.logoFile ? await filesApi.signedUrl(record.logoFile) : null,
        timeZone: record.timeZone,
        isDemo: record.isDemo,
      },
      settings: resolveSettings(data),
      saved: Object.keys(data),
      etag: etagOf(record.version, saved?.version ?? 0),
    }
  }

  private buildAuditedBuilding() {
    const { audited, buildings, directory } = this.deps
    return audited(
      {
        action: 'building.building.update',
        object: (r: { id: string }) => ({ type: 'building', id: r.id }),
        masks: BUILDING_MASKS,
      },
      async (
        staff: StaffContext,
        input: { patch: BuildingPatch; current: BuildingRecord; version: number },
      ) => {
        const { patch, current } = input
        const columns = patchedFields(patch)
        const after: BuildingFields = { ...fieldsOf(current), ...columns }
        if (patch.logoFileId !== undefined && patch.logoFileId !== current.logoFile) {
          await this.swapLogo(staff, current, patch.logoFileId)
          after.logoFile = patch.logoFileId
        }
        const moved = await buildings.updateGuarded(current.id, input.version, {
          ...columns,
          ...(patch.logoFileId !== undefined ? { logoFile: patch.logoFileId } : {}),
        })
        if (moved === null) {
          directory.invalidate(current.id)
          throw new VersionConflictError()
        }
        return { result: { id: current.id }, changes: diffBuilding(fieldsOf(current), after) }
      },
    )
  }

  /** The new logo is attached and the old one removed, in the transaction of the update: a rollback keeps the old (BD-10). */
  private async swapLogo(staff: StaffContext, current: BuildingRecord, next: string | null) {
    const { files, filesApi } = this.deps
    const actor = {
      accountKind: 'staff' as const,
      accountId: staff.staffId,
      buildingId: staff.buildingId,
      scope: staff.scope,
      role: staff.role,
    }
    if (next !== null) {
      const file = await files.find(staff.scope, next)
      if (file?.purpose !== 'logo')
        throw new RuleViolationError('not_a_logo', 'The file is not a logo', 'building.logoFileId')
      await filesApi.attach(actor, next, `building:${current.id}`)
    }
    if (current.logoFile) await filesApi.remove(actor, current.logoFile)
  }

  private buildAuditedSettings() {
    const { audited, settings, directory } = this.deps
    return audited(
      {
        action: 'building.settings.update',
        object: (r: { id: string }) => ({ type: 'building_setting', id: r.id }),
      },
      async (
        staff: StaffContext,
        input: { patch: SettingsPatch; saved: { data: Record<string, unknown>; version: number } },
      ) => {
        const merge = mergeSettings(input.saved.data, input.patch)
        const row = await settings.mergeGuarded(
          staff.scope,
          input.saved.version,
          merge.set,
          merge.remove,
        )
        if (!row) {
          directory.invalidate(staff.buildingId)
          throw new VersionConflictError()
        }
        return { result: { id: staff.buildingId }, changes: merge.changes }
      },
    )
  }
}

function assertAdmin(staff: StaffContext): void {
  if (staff.role !== 'admin') throw new ForbiddenError()
}
