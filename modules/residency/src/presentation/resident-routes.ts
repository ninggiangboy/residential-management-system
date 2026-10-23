import { type Idempotent, type RouteSet, routePlugin, staffRoute, strictObject } from '@core/http'
import { type Guards, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import { RESIDENT_READ_ROLES, type ResidentQueries } from '../application/queries/resident-queries'
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
  guards: Guards
  idempotent: Idempotent
}

const AccountParams = strictObject({ accountId: Type.String({ format: 'uuid' }) })
const MemberType = Type.Union([
  Type.Literal('owner'),
  Type.Literal('family'),
  Type.Literal('tenant'),
  Type.Literal('helper'),
])
const NullableString = (maxLength: number) => Type.Union([Type.String({ maxLength }), Type.Null()])

const CreateBody = strictObject({
  unitId: Type.String({ format: 'uuid' }),
  phone: Type.String({ maxLength: 40 }),
  fullName: Type.String({ maxLength: 200 }),
  memberType: MemberType,
  canPay: Type.Optional(Type.Boolean()),
  email: Type.Optional(NullableString(254)),
  note: Type.Optional(NullableString(2000)),
})
const UpdateBody = strictObject({
  fullName: Type.Optional(Type.String({ maxLength: 200 })),
  email: Type.Optional(NullableString(254)),
  cccd: Type.Optional(NullableString(40)),
  dateOfBirth: Type.Optional(NullableString(10)),
  note: Type.Optional(NullableString(2000)),
})
const PhoneBody = strictObject({ phone: Type.String({ maxLength: 40 }) })
const ListQuery = strictObject({
  q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  unitId: Type.Optional(Type.String({ format: 'uuid' })),
  memberType: Type.Optional(MemberType),
  status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('locked')])),
  deletion: Type.Optional(Type.Literal('requested')),
  neverSignedIn: Type.Optional(Type.Union([Type.Literal('true'), Type.Literal('false')])),
  cursor: Type.Optional(Type.String({ maxLength: 300 })),
  limit: Type.Optional(Type.String({ maxLength: 8 })),
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
 * `/staff/residents` (E-63…E-67; DOC-27 §5, §8, §11): the list and search, the detail (the one `pii.read` view), the add, the
 * profile edit and the login phone change. Every handler is the call of a use case or a query service and holds no rule.
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

  const read = staffRoute(d.guards, 'residency', RESIDENT_READ_ROLES)

  return routePlugin({ prefix: '/staff/residents' })
    .get('/', list, { ...read, query: ListQuery })
    .post('/', d.idempotent({ account: staffAccount }, create), {
      ...staffRoute(d.guards, 'residency', CREATE_RESIDENT_ROLES, { idempotent: true }),
      body: CreateBody,
    })
    .get('/:accountId', get, { ...read, params: AccountParams })
    .patch('/:accountId', update, {
      ...staffRoute(d.guards, 'residency', UPDATE_PROFILE_ROLES),
      params: AccountParams,
      body: UpdateBody,
    })
    .patch('/:accountId/phone', changePhone, {
      ...staffRoute(d.guards, 'residency', CHANGE_LOGIN_PHONE_ROLES),
      params: AccountParams,
      body: PhoneBody,
    })
}
