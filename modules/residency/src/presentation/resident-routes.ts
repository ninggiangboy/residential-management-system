import {
  describedEnum,
  type Idempotent,
  type RouteInfo,
  type RouteSet,
  routePlugin,
  staffRoute,
  strictObject,
} from '@core/http'
import { type Guards, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import { RESIDENT_READ_ROLES, type ResidentQueries } from '../application/queries/resident-queries'
import {
  APPROVE_ACCOUNT_DELETION_ROLES,
  type ApproveAccountDeletion,
} from '../application/use-cases/approve-account-deletion'
import {
  CHANGE_LOGIN_PHONE_ROLES,
  type ChangeLoginPhone,
} from '../application/use-cases/change-login-phone'
import {
  CREATE_RESIDENT_ROLES,
  type CreateResident,
} from '../application/use-cases/create-resident'
import { UPDATE_PROFILE_ROLES, type UpdateProfile } from '../application/use-cases/update-profile'
import type { ProfileEdit, ResidentProfileRecord } from '../domain/resident-profile'
import { decodeCursor, encodeCursor, quoted, staffAccount, versionOf, wholeParam } from './http'

export interface ResidentRouteDeps {
  residentQueries: ResidentQueries
  createResident: CreateResident
  updateProfile: UpdateProfile
  changeLoginPhone: ChangeLoginPhone
  approveAccountDeletion: ApproveAccountDeletion
  guards: Guards
  idempotent: Idempotent
}

const AccountParams = strictObject({
  accountId: Type.String({ format: 'uuid', description: 'The id of the resident account' }),
})
const MemberType = describedEnum(
  {
    owner: 'The owner of the unit',
    family: 'A family member of the owner',
    tenant: 'A tenant',
    helper: 'A domestic helper',
  },
  'How the person is linked to the unit.',
)
const NullableString = (maxLength: number, description: string) =>
  Type.Union([Type.String({ maxLength }), Type.Null()], { description })

const CreateBody = strictObject({
  unitId: Type.String({
    format: 'uuid',
    description: 'The unit of the building the person is added to',
  }),
  phone: Type.String({
    maxLength: 40,
    description:
      'The phone the person signs in with. An existing phone links the unit to the existing account. An invalid one is 400 `phone_invalid`',
  }),
  fullName: Type.String({
    maxLength: 200,
    description: 'The full name, 2…100 characters with a letter',
  }),
  memberType: MemberType,
  canPay: Type.Optional(
    Type.Boolean({
      description: 'Whether a tenant may pay fees (default `false`). Only with `tenant`',
    }),
  ),
  email: Type.Optional(NullableString(254, 'A valid email address, stored lower-case')),
  note: Type.Optional(NullableString(2000, 'A note of the manager, at most 500 characters')),
})
const UpdateBody = strictObject({
  fullName: Type.Optional(
    Type.String({ maxLength: 200, description: 'The full name, 2…100 characters' }),
  ),
  email: Type.Optional(NullableString(254, 'A valid email address. `null` clears it')),
  cccd: Type.Optional(
    NullableString(
      40,
      'The ID number: 12 digits (CCCD) or 9 digits (CMND), spaces removed. `null` clears it',
    ),
  ),
  dateOfBirth: Type.Optional(
    NullableString(
      10,
      'The date of birth as `YYYY-MM-DD`, from 1900-01-01 to today. `null` clears it',
    ),
  ),
  note: Type.Optional(
    NullableString(2000, 'A note of the manager, at most 500 characters. `null` clears it'),
  ),
})
const PhoneBody = strictObject({
  phone: Type.String({
    maxLength: 40,
    description: 'The new login phone, Vietnamese or international',
  }),
})
const ListQuery = strictObject({
  q: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 100,
      description:
        'Searches by name (at least 3 characters, case and diacritics ignored) or by the end of the phone (at least 4 digits). A search returns at most 20 rows and no cursor',
    }),
  ),
  unitId: Type.Optional(
    Type.String({
      format: 'uuid',
      description: 'Only residents with a membership of this unit that is not removed',
    }),
  ),
  memberType: Type.Optional(MemberType),
  status: Type.Optional(
    describedEnum(
      { active: 'The membership is in use', locked: 'The membership is locked' },
      'The status of the membership.',
    ),
  ),
  deletion: Type.Optional(
    describedEnum(
      { requested: 'Only accounts whose holder asked to delete them and wait for approval' },
      'Filters on account deletion requests.',
    ),
  ),
  neverSignedIn: Type.Optional(
    describedEnum(
      {
        true: 'Only accounts that never opened the app',
        false: 'No filter',
      },
      'Filters on whether the person ever opened the app.',
    ),
  ),
  cursor: Type.Optional(
    Type.String({
      maxLength: 300,
      description:
        'The `next` cursor of the previous page. Opaque; one that does not decode is 400 `invalid_cursor`',
    }),
  ),
  limit: Type.Optional(
    Type.String({ maxLength: 8, description: 'Rows per page, 1…200 (default 50)' }),
  ),
})

const defined = <T extends object>(body: T): T =>
  Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) as T

/** The answer of E-66: neither the ID number nor the date of birth, so the edit is not a `pii.read` view. */
const profileBody = (profile: ResidentProfileRecord) => ({
  accountId: profile.accountId,
  fullName: profile.fullName,
  email: profile.email,
  cccdMasked: profile.cccdLast4 === null ? null : `•••• ${profile.cccdLast4}`,
  hasDateOfBirth: profile.dateOfBirth !== null,
  note: profile.note,
  version: profile.version,
})

/**
 * `/staff/residents` (E-63…E-68; DOC-27 §5, §8, §11, DOC-35 §10): the list and search, the detail (the one `pii.read` view), the add, the
 * profile edit, the login phone change and the approval of a deletion request. Every handler is the call of a use case or a query service and holds no rule.
 */
export function residentRoutes(d: ResidentRouteDeps) {
  const list = async (context: { query: Static<typeof ListQuery> }) => {
    const { q, unitId, memberType, status, deletion, cursor } = context.query
    const page = await d.residentQueries.list(staffOf(context), {
      q,
      unitId,
      memberType,
      status,
      deletion,
      neverSignedIn: context.query.neverSignedIn === 'true',
      after: cursor === undefined ? undefined : decodeCursor(cursor, ['i'] as const).i,
      limit: wholeParam('limit', context.query.limit, 1, 200) ?? 50,
    })
    return {
      items: page.items,
      nextCursor: page.next ? encodeCursor({ i: page.next }) : null,
      summary: { total: page.total },
    }
  }

  const create = async (context: {
    body: Static<typeof CreateBody>
    request: Request
    set: RouteSet
  }) => {
    const { profileFilled: _filled, ...added } = await d.createResident.execute(staffOf(context), {
      ...context.body,
      canPay: context.body.canPay ?? false,
      email: context.body.email ?? null,
      note: context.body.note ?? null,
    })
    context.set.status = 201
    context.set.headers.location = `/api/v1/staff/residents/${added.accountId}`
    return added
  }

  const get = async (context: { params: Static<typeof AccountParams>; set: RouteSet }) => {
    const detail = await d.residentQueries.get(staffOf(context), context.params.accountId)
    context.set.headers.etag = quoted(detail.profile.version)
    context.set.headers['cache-control'] = 'no-store'
    return detail
  }

  const update = async (context: {
    params: Static<typeof AccountParams>
    body: Static<typeof UpdateBody>
    request: Request
    set: RouteSet
  }) => {
    const profile = await d.updateProfile.execute(staffOf(context), context.params.accountId, {
      edit: defined(context.body) as ProfileEdit,
      version: versionOf(context.request.headers.get('if-match')),
    })
    context.set.headers.etag = quoted(profile.version)
    return profileBody(profile)
  }

  const changePhone = async (context: {
    params: Static<typeof AccountParams>
    body: Static<typeof PhoneBody>
    set: RouteSet
  }) => {
    await d.changeLoginPhone.execute(staffOf(context), context.params.accountId, context.body.phone)
    context.set.status = 204
  }

  const approveDeletion = (context: { params: Static<typeof AccountParams> }) =>
    d.approveAccountDeletion.execute(staffOf(context), context.params.accountId)

  const read = (info: RouteInfo) => staffRoute(d.guards, 'residency', RESIDENT_READ_ROLES, info)

  return routePlugin({ prefix: '/staff/residents' })
    .get('/', list, {
      ...read({
        endpoint: 'E-63',
        operationId: 'listResidents',
        summary: 'List residents',
        description: 'The resident list and search, including pending account deletion requests.',
      }),
      query: ListQuery,
    })
    .post('/', d.idempotent({ account: staffAccount }, create), {
      ...staffRoute(d.guards, 'residency', CREATE_RESIDENT_ROLES, {
        endpoint: 'E-64',
        operationId: 'createResident',
        summary: 'Add a resident to a unit',
        description:
          'Adds a person to a unit: the owner of an ownerless unit, or a family member, tenant or helper. An existing phone links the unit to the existing account; no invitation SMS is sent. Needs an `Idempotency-Key`.',
        idempotent: true,
      }),
      body: CreateBody,
    })
    .get('/:accountId', get, {
      ...read({
        endpoint: 'E-65',
        operationId: 'getResident',
        summary: 'Get a resident',
        description:
          'The resident detail with the full ID number and the date of birth. Reading it is a personal-data read and is audited.',
      }),
      params: AccountParams,
    })
    .patch('/:accountId', update, {
      ...staffRoute(d.guards, 'residency', UPDATE_PROFILE_ROLES, {
        endpoint: 'E-66',
        operationId: 'updateResidentProfile',
        summary: 'Update a resident profile',
        description:
          'Edits the building record of a person. The display name of the account is a different field and is not changed here.',
      }),
      params: AccountParams,
      body: UpdateBody,
    })
    .patch('/:accountId/phone', changePhone, {
      ...staffRoute(d.guards, 'residency', CHANGE_LOGIN_PHONE_ROLES, {
        endpoint: 'E-67',
        operationId: 'changeResidentPhone',
        summary: 'Change the login phone of a resident',
        description:
          'Changes the phone a resident signs in with. Every session of the account is revoked; memberships and QR codes are unchanged.',
      }),
      params: AccountParams,
      body: PhoneBody,
    })
    .post('/:accountId/deletion/approve', approveDeletion, {
      ...staffRoute(d.guards, 'residency', APPROVE_ACCOUNT_DELETION_ROLES, {
        endpoint: 'E-68',
        operationId: 'approveAccountDeletion',
        summary: 'Approve an account deletion',
        description:
          'Approves a resident request to delete their account; the deletion job executes it after the configured waiting period. There is no reject: a manager who does not approve leaves the account `deletion_requested`.',
      }),
      params: AccountParams,
    })
}
