import {
  type Clock,
  NotFoundError,
  PreconditionRequiredError,
  requireRole,
  type SecretBox,
  type UnitOfWork,
  VersionConflictError,
} from '@core/kernel'
import type { AuditChange, Audited } from '@mod/audit/contracts'
import type { BuildingApi } from '@mod/building/contracts'
import { buildingToday, type StaffContext, type StaffRole } from '@rms/shared-types'
import {
  cccdAad,
  normalizeCccd,
  type ProfileEdit,
  ResidentProfile,
  type ResidentProfileRecord,
} from '../../domain/resident-profile'
import type { ResidentProfileRepository } from '../../domain/resident-profile-repository'

/** The Manager's and the Admin's alone (DOC-27 §3.3). */
export const UPDATE_PROFILE_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface UpdateProfileInput {
  edit: ProfileEdit
  /** `If-Match`: the profile `version` the Manager saw; absent is 428. */
  version: number | undefined
}

const FIELDS = ['fullName', 'email', 'cccd', 'dateOfBirth', 'note'] as const

/**
 * `PATCH /staff/residents/{accountId}` (DOC-27 §5.3): edits the building's record of a person. The ID number is sealed with the
 * PII key and `cccd|<building>|<account>` before it reaches the row, with its last four digits beside it. An account with no
 * profile in this building is 404, which is also how a Manager is tied to a person (DR-136). The audit row lists the fields that
 * changed, all masked.
 */
export class UpdateProfile {
  private readonly auditedUpdate: ReturnType<UpdateProfile['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly profiles: ResidentProfileRepository,
    private readonly building: Pick<BuildingApi, 'getBuilding'>,
    private readonly pii: () => SecretBox,
    audited: Audited,
    private readonly clock: Clock,
  ) {
    this.auditedUpdate = this.buildAudited(audited)
  }

  async execute(staff: StaffContext, accountId: string, input: UpdateProfileInput) {
    requireRole(staff, UPDATE_PROFILE_ROLES)
    if (input.version === undefined) throw new PreconditionRequiredError()
    return this.uow.run(() =>
      this.auditedUpdate(staff, accountId, input.edit, input.version as number),
    )
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'residency.profile.update',
        object: (accountId: string) => ({ type: 'resident_profile', id: accountId }),
        masks: {
          fullName: 'personal',
          email: 'email',
          cccd: 'personal',
          dateOfBirth: 'personal',
          note: 'personal',
        },
      },
      async (staff: StaffContext, accountId: string, edit: ProfileEdit, version: number) => ({
        result: accountId,
        changes: await this.update(staff, accountId, edit, version),
      }),
    )
  }

  private async update(
    staff: StaffContext,
    accountId: string,
    edit: ProfileEdit,
    version: number,
  ): Promise<AuditChange[]> {
    const { profiles, clock } = this
    const record = await profiles.find(staff.scope, accountId)
    if (!record || record.clearedAt !== null) throw new NotFoundError()
    if (record.version !== version) throw new VersionConflictError()
    const now = clock.now()
    const building = await this.building.getBuilding(staff.buildingId)
    const today = buildingToday(now, building?.timeZone ?? 'Asia/Ho_Chi_Minh')
    const transition = new ResidentProfile(record).edit(
      edit,
      await this.sealed(staff, accountId, edit),
      today,
    )
    if (!transition) return []
    // A second edit with the same `If-Match` finds the version moved: 409, nothing written.
    const after = await profiles.apply(staff.scope, transition, now)
    if (!after) throw new VersionConflictError()
    return changedFields(record, after, edit)
  }

  /** The number sealed with the newest key; `null` clears it, `undefined` leaves it alone. */
  private async sealed(staff: StaffContext, accountId: string, edit: ProfileEdit) {
    if (edit.cccd === undefined || edit.cccd === null) return edit.cccd
    const digits = normalizeCccd(edit.cccd)
    return {
      cccdEnc: await this.pii().seal(cccdAad(staff.buildingId, accountId), digits),
      cccdLast4: digits.slice(-4),
    }
  }
}

/**
 * The fields the edit changed. The wrapper masks the values (DOC-35 §3.4): every field is recorded as `[masked]` except the email,
 * whose masked shape `l•••@example.com` is the one the deny-list accepts, so it travels as a value and not as a placeholder.
 */
function changedFields(
  before: ResidentProfileRecord,
  after: ResidentProfileRecord,
  edit: ProfileEdit,
): AuditChange[] {
  const same = (field: (typeof FIELDS)[number]) =>
    field === 'cccd' ? before.cccdEnc === after.cccdEnc : before[field] === after[field]
  return FIELDS.filter((field) => edit[field] !== undefined && !same(field)).map((field) =>
    field === 'email'
      ? { field, before: before.email, after: after.email }
      : { field, before: '', after: '' },
  )
}
