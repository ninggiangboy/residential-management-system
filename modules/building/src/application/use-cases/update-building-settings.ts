import {
  NotFoundError,
  PreconditionRequiredError,
  RuleViolationError,
  requireRole,
  type UnitOfWork,
  VersionConflictError,
} from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { FilesApi, SettingsPatch } from '../../contracts'
import {
  assertBuildingPatch,
  type BuildingFields,
  type BuildingPatch,
  diffBuilding,
  patchedFields,
} from '../../domain/building-fields'
import type { BuildingRecord, BuildingRepository } from '../../domain/building-repository'
import type { FileRepository } from '../../domain/file-repository'
import { assertPatchInRange, mergeSettings } from '../../domain/settings'
import type { SettingsRepository } from '../../domain/settings-repository'
import { type BuildingDocument, type BuildingDocumentLoader, parseEtag } from '../building-document'
import type { BuildingDirectory } from '../directory'

export interface UpdateSettingsInput {
  building?: BuildingPatch
  settings?: SettingsPatch
  /** The `If-Match` the client sent: `"3.8"`, or `undefined` when it sent none. */
  etag: string | undefined
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

/** The settings are the Admin's alone (DOC-36 §4). The route reads this list for its `audience` (DOC-12 §5.3). */
export const UPDATE_BUILDING_SETTINGS_ROLES = ['admin'] as const satisfies readonly StaffRole[]

/**
 * `PATCH /staff/settings` (DOC-36 §4): the Admin edits the building row and the settings in one transaction, each guarded by
 * the version the form read, each with its own audit row; a request that changes one part leaves the other alone.
 */
export class UpdateBuildingSettings {
  private readonly auditedBuilding: ReturnType<UpdateBuildingSettings['buildAuditedBuilding']>
  private readonly auditedSettings: ReturnType<UpdateBuildingSettings['buildAuditedSettings']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly buildings: BuildingRepository,
    private readonly settings: SettingsRepository,
    private readonly files: FileRepository,
    private readonly filesApi: FilesApi,
    private readonly directory: BuildingDirectory,
    private readonly documents: BuildingDocumentLoader,
    private readonly audited: Audited,
  ) {
    this.auditedBuilding = this.buildAuditedBuilding()
    this.auditedSettings = this.buildAuditedSettings()
  }

  async execute(staff: StaffContext, input: UpdateSettingsInput): Promise<BuildingDocument> {
    requireRole(staff, UPDATE_BUILDING_SETTINGS_ROLES)
    if (input.etag === undefined) throw new PreconditionRequiredError()
    const versions = parseEtag(input.etag)
    if (input.settings) assertPatchInRange(input.settings)
    if (input.building) assertBuildingPatch(input.building)

    const { uow, directory, documents } = this
    await uow.run(async () => {
      const current = await this.buildings.find(staff.buildingId)
      if (!current) throw new NotFoundError()
      const saved = await this.settings.find(staff.scope)
      // A stale form fails even when nothing raced in between (DOC-12 §9.2).
      const stale =
        !versions ||
        (input.building && versions.building !== current.version) ||
        (input.settings && versions.settings !== (saved?.version ?? 0))
      if (stale) throw new VersionConflictError(await documents.load(staff.buildingId))

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
    return documents.load(staff.buildingId)
  }

  private buildAuditedBuilding() {
    const { audited, buildings, directory } = this
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

  /**
   * The new logo is attached in the transaction of the update; a rollback keeps the old (BD-10). The old logo stays
   * attached: receipt snapshots name it by file id, so a later void copy still prints it (DR-296).
   */
  private async swapLogo(staff: StaffContext, current: BuildingRecord, next: string | null) {
    const { files, filesApi } = this
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
  }

  private buildAuditedSettings() {
    const { audited, settings, directory } = this
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
