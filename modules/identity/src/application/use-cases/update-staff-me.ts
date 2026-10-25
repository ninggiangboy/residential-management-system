import {
  type Clock,
  NotFoundError,
  PreconditionRequiredError,
  RuleViolationError,
  requireRole,
  type UnitOfWork,
  ValidationError,
  VersionConflictError,
} from '@core/kernel'
import type { AuditChange, Audited } from '@mod/audit/contracts'
import type { FilesApi } from '@mod/building/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { Language } from '../../contracts'
import { StaffAccount, type StaffAccountRecord } from '../../domain/staff-account'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import { type StaffMeView, toStaffMeView } from '../staff-me-view'

/** Every staff role edits its own profile (DOC-26 §7). The route reads this list for its `audience`. */
export const UPDATE_STAFF_ME_ROLES = [
  'admin',
  'manager',
  'technician',
  'guard',
] as const satisfies readonly StaffRole[]

export interface UpdateStaffMeInput {
  fullName?: string
  language?: Language
  pushEnabled?: boolean
  /** A verified `avatar` file of this account; `null` removes the avatar. */
  avatarFileId?: string | null
  /** `If-Match`; absent is 428. */
  version: number | undefined
}

type Files = Pick<FilesApi, 'verify' | 'attach' | 'remove' | 'signedUrl'>

const FIELDS = ['fullName', 'language', 'pushEnabled', 'avatarKey'] as const

/**
 * `PATCH /staff/me` (E-31, DOC-26 §7): the member edits their name, language, push setting and avatar. The email and the role are
 * not here (E-42). The version the form read is the guard (428, 409); a new avatar is attached and the old one removed in the
 * transaction of the update, so a rollback keeps the old one (DOC-37 §6.4).
 */
export class UpdateStaffMe {
  private readonly auditedUpdate: ReturnType<UpdateStaffMe['buildAuditedUpdate']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly staffAccounts: StaffAccountRepository,
    private readonly files: Files,
    private readonly clock: Clock,
    audited: Audited,
  ) {
    this.auditedUpdate = this.buildAuditedUpdate(audited)
  }

  async execute(staff: StaffContext, input: UpdateStaffMeInput): Promise<StaffMeView> {
    requireRole(staff, UPDATE_STAFF_ME_ROLES)
    if (input.version === undefined) throw new PreconditionRequiredError()
    const { version, ...raw } = input
    const changes =
      raw.fullName === undefined ? raw : { ...raw, fullName: raw.fullName.normalize('NFC').trim() }
    if (changes.fullName === '' || (changes.fullName?.length ?? 0) > 120)
      throw new ValidationError([
        {
          path: 'fullName',
          code: changes.fullName === '' ? 'min_length' : 'max_length',
          message: 'fullName',
        },
      ])
    if (Object.keys(changes).length === 0)
      throw new ValidationError([{ path: '', code: 'min_properties', message: 'min_properties' }])
    // The bucket is asked outside any transaction (DOC-12 §8.2). `verify` answers the same for a verified file again (DR-146).
    if (changes.avatarFileId) await this.requireAvatar(staff, changes.avatarFileId)
    return this.uow.run(() => this.auditedUpdate(staff, changes, version))
  }

  private async requireAvatar(staff: StaffContext, fileId: string): Promise<void> {
    const file = await this.files.verify(fileActorOf(staff), fileId)
    if (file.purpose !== 'avatar')
      throw new RuleViolationError(
        'not_an_avatar',
        'The file is not an avatar',
        'avatarFileId',
        'file_not_verified',
      )
  }

  private buildAuditedUpdate(audited: Audited) {
    return audited(
      {
        action: 'identity.staff.update',
        object: (updated: StaffMeView) => ({ type: 'staff_account', id: updated.id }),
        masks: { fullName: 'personal' },
        details: () => ({ self: true }),
      },
      async (staff: StaffContext, changes: Omit<UpdateStaffMeInput, 'version'>, version: number) =>
        this.update(staff, changes, version),
    )
  }

  private async update(
    staff: StaffContext,
    changes: Omit<UpdateStaffMeInput, 'version'>,
    version: number,
  ) {
    const { staffAccounts, files } = this
    const before = await staffAccounts.findById(staff.staffId)
    if (!before) throw new NotFoundError()
    if (before.version !== version) throw new VersionConflictError()
    const { avatarFileId, ...rest } = changes
    const transition = new StaffAccount(before).editSelf({
      ...rest,
      ...(avatarFileId === undefined ? {} : { avatarKey: avatarFileId }),
    })
    if (!transition) return { result: await this.view(before), changes: [] satisfies AuditChange[] }

    const actor = fileActorOf(staff)
    if (changes.avatarFileId !== undefined) {
      if (changes.avatarFileId !== null)
        await files.attach(actor, changes.avatarFileId, `staff:${before.id}`)
      if (before.avatarKey) await files.remove(actor, before.avatarKey)
    }
    const applied = await staffAccounts.apply(transition, this.clock.now())
    if (!applied) throw new VersionConflictError()
    const after = { ...before, ...transition.set }
    return { result: await this.view(after), changes: changedFields(before, after) }
  }

  private async view(record: StaffAccountRecord): Promise<StaffMeView> {
    const url = record.avatarKey
      ? await this.files.signedUrl(record.avatarKey, { variant: 'thumb' })
      : null
    return toStaffMeView(record, url)
  }
}

const fileActorOf = (staff: StaffContext) => ({
  accountKind: 'staff' as const,
  accountId: staff.staffId,
  buildingId: staff.buildingId,
  scope: staff.scope,
  role: staff.role,
})

/** The fields the edit changed; the wrapper masks the personal ones (DOC-35 §3.4). The avatar is recorded as a changed field without its id. */
function changedFields(before: StaffAccountRecord, after: StaffAccountRecord): AuditChange[] {
  return FIELDS.filter((field) => before[field] !== after[field]).map((field) => ({
    field,
    before: field === 'avatarKey' ? (before[field] === null ? null : '[file]') : before[field],
    after: field === 'avatarKey' ? (after[field] === null ? null : '[file]') : after[field],
  }))
}
