import {
  API_PREFIX,
  type Idempotent,
  IdParams,
  type RouteSet,
  routePlugin,
  staffRoute,
  strictObject,
} from '@core/http'
import { ValidationError, VersionConflictError } from '@core/kernel'
import { type Guards, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import {
  LIST_STAFF_SESSIONS_ROLES,
  type SessionQueries,
} from '../application/queries/session-queries'
import {
  GET_STAFF_ACCOUNT_ROLES,
  GET_STAFF_ME_ROLES,
  LIST_STAFF_ACCOUNTS_ROLES,
  type StaffQueries,
} from '../application/queries/staff-queries'
import type { StaffAccountView } from '../application/staff-account-view'
import {
  CREATE_STAFF_ACCOUNT_ROLES,
  type CreateStaffAccount,
} from '../application/use-cases/create-staff-account'
import {
  DISABLE_STAFF_ACCOUNT_ROLES,
  type DisableStaffAccount,
} from '../application/use-cases/disable-staff-account'
import {
  ENABLE_STAFF_ACCOUNT_ROLES,
  type EnableStaffAccount,
} from '../application/use-cases/enable-staff-account'
import {
  LOCK_STAFF_ACCOUNT_ROLES,
  type LockStaffAccount,
} from '../application/use-cases/lock-staff-account'
import { REQUEST_STEP_UP_ROLES, type RequestStepUp } from '../application/use-cases/request-step-up'
import {
  REVOKE_STAFF_SESSION_ROLES,
  type RevokeStaffSession,
} from '../application/use-cases/revoke-staff-session'
import {
  UNLOCK_STAFF_ACCOUNT_ROLES,
  type UnlockStaffAccount,
} from '../application/use-cases/unlock-staff-account'
import {
  UPDATE_STAFF_ACCOUNT_ROLES,
  type UpdateStaffAccount,
} from '../application/use-cases/update-staff-account'

export interface StaffRouteDeps {
  requestStepUp: RequestStepUp
  revokeStaffSession: RevokeStaffSession
  createStaffAccount: CreateStaffAccount
  updateStaffAccount: UpdateStaffAccount
  lockStaffAccount: LockStaffAccount
  unlockStaffAccount: UnlockStaffAccount
  disableStaffAccount: DisableStaffAccount
  enableStaffAccount: EnableStaffAccount
  staffQueries: StaffQueries
  sessionQueries: SessionQueries
  guards: Guards
  /** E-40 takes an `Idempotency-Key` (DOC-50 §8.1). */
  idempotent: Idempotent
}

const StepUpBody = strictObject({
  action: Type.Union([
    Type.Literal('gateway_config'),
    Type.Literal('admin_change'),
    Type.Literal('staff_email'),
  ]),
})

const Role = Type.Union([
  Type.Literal('admin'),
  Type.Literal('manager'),
  Type.Literal('technician'),
  Type.Literal('guard'),
])
const Status = Type.Union([
  Type.Literal('invited'),
  Type.Literal('active'),
  Type.Literal('locked'),
  Type.Literal('disabled'),
])
const Language = Type.Union([Type.Literal('vi'), Type.Literal('en')])
const ProofBody = strictObject({
  password: Type.String({ minLength: 1, maxLength: 128 }),
  code: Type.String({ pattern: '^[0-9]{6}$' }),
})
const FullName = Type.String({ minLength: 1, maxLength: 120 })
const Email = Type.String({ format: 'email', maxLength: 254 })

const ListQuery = strictObject({
  page: Type.Optional(Type.String({ pattern: '^[0-9]{1,5}$' })),
  pageSize: Type.Optional(Type.String({ pattern: '^[0-9]{1,3}$' })),
  role: Type.Optional(Role),
  status: Type.Optional(Status),
  q: Type.Optional(Type.String({ maxLength: 100 })),
})
const CreateBody = strictObject({
  fullName: FullName,
  email: Email,
  role: Role,
  language: Type.Optional(Language),
  stepUp: Type.Optional(ProofBody),
})
const UpdateBody = strictObject({
  fullName: Type.Optional(FullName),
  language: Type.Optional(Language),
  role: Type.Optional(Role),
  email: Type.Optional(Email),
  reassignTo: Type.Optional(Type.String({ format: 'uuid' })),
  reason: Type.Optional(Type.String({ maxLength: 1000 })),
  stepUp: Type.Optional(ProofBody),
})
const ReassignBody = Type.Optional(
  strictObject({
    reassignTo: Type.Optional(Type.String({ format: 'uuid' })),
    reason: Type.Optional(Type.String({ maxLength: 1000 })),
  }),
)

const quoted = (version: number) => `"${version}"`

/** `If-Match: "3"` → `3`; a header that is not a whole number cannot match any version. */
function versionOf(header: string | null): number | undefined {
  if (header === null) return undefined
  const match = /^"?(\d+)"?$/.exec(header.trim())
  if (!match) throw new VersionConflictError()
  return Number(match[1])
}

/** The key belongs to the staff account (DOC-50 §8.3). */
const staffAccountKey = (context: object) => ({
  kind: 'staff' as const,
  id: staffOf(context).staffId as string,
})

/**
 * `/staff/*` of `identity` (DOC-26 §7): the profile, the sessions of the signed-in member, the step-up code request and the staff
 * accounts (E-39…E-46, DOC-51 §8). Every handler is the call of a use case or a query; the rules are theirs.
 */
export function staffRoutes(d: StaffRouteDeps) {
  const me = (context: object) => d.staffQueries.me(staffOf(context))

  const listSessions = async (context: object) => {
    const staff = staffOf(context)
    return { items: await d.sessionQueries.listStaff(staff, staff.sessionId) }
  }

  const revokeSession = async (context: { params: Static<typeof IdParams>; set: RouteSet }) => {
    await d.revokeStaffSession.execute(staffOf(context), context.params.id)
    context.set.status = 204
  }

  const requestStepUp = async (context: { body: Static<typeof StepUpBody>; set: RouteSet }) => {
    await d.requestStepUp.execute(staffOf(context), context.body.action)
    context.set.status = 204
  }

  const accountReply = (set: RouteSet, account: StaffAccountView) => {
    set.headers.etag = quoted(account.version)
    return account
  }

  const listAccounts = async (context: { query: Static<typeof ListQuery> }) => {
    const { page: rawPage, pageSize: rawSize, ...filter } = context.query
    const page = rawPage === undefined ? 1 : Number(rawPage)
    const pageSize = rawSize === undefined ? 10 : Number(rawSize)
    const bad = (path: string, code: string) => new ValidationError([{ path, code, message: code }])
    if (page < 1) throw bad('page', 'minimum')
    if (pageSize < 1) throw bad('pageSize', 'minimum')
    if (pageSize > 50) throw bad('pageSize', 'maximum')
    if (page * pageSize > 10_000) throw bad('page', 'maximum')
    return d.staffQueries.list(staffOf(context), { ...filter, page, pageSize })
  }

  const createAccount = async (context: {
    body: Static<typeof CreateBody>
    request: Request
    set: RouteSet
  }) => {
    const created = await d.createStaffAccount.execute(staffOf(context), context.body)
    context.set.status = 201
    context.set.headers.location = `${API_PREFIX}/staff/accounts/${created.account.id}`
    return {
      ...accountReply(context.set, created.account),
      invite: { expiresAt: created.inviteExpiresAt },
    }
  }

  const getAccount = async (context: {
    params: Static<typeof IdParams>
    request: Request
    set: RouteSet
  }) => {
    const account = await d.staffQueries.get(staffOf(context), context.params.id)
    const etag = quoted(account.version)
    context.set.headers.etag = etag
    context.set.headers['cache-control'] = 'private, no-cache'
    if (context.request.headers.get('if-none-match') === etag) {
      context.set.status = 304
      return undefined
    }
    return account
  }

  const updateAccount = async (context: {
    params: Static<typeof IdParams>
    body: Static<typeof UpdateBody>
    request: Request
    set: RouteSet
  }) => {
    const { reassignTo, reason, stepUp, ...changes } = context.body
    if (Object.keys(changes).length === 0)
      throw new ValidationError([{ path: '', code: 'min_properties', message: 'min_properties' }])
    const account = await d.updateStaffAccount.execute(staffOf(context), context.params.id, {
      changes,
      version: versionOf(context.request.headers.get('if-match')),
      reassignTo,
      reason,
      stepUp,
    })
    return accountReply(context.set, account)
  }

  const lockAccount = async (context: {
    params: Static<typeof IdParams>
    body: Static<typeof ReassignBody> | null
    set: RouteSet
  }) =>
    accountReply(
      context.set,
      await d.lockStaffAccount.execute(staffOf(context), context.params.id, context.body ?? {}),
    )

  const unlockAccount = async (context: { params: Static<typeof IdParams>; set: RouteSet }) =>
    accountReply(
      context.set,
      await d.unlockStaffAccount.execute(staffOf(context), context.params.id),
    )

  const disableAccount = async (context: {
    params: Static<typeof IdParams>
    body: Static<typeof ReassignBody> | null
    set: RouteSet
  }) =>
    accountReply(
      context.set,
      await d.disableStaffAccount.execute(staffOf(context), context.params.id, context.body ?? {}),
    )

  const enableAccount = async (context: { params: Static<typeof IdParams>; set: RouteSet }) =>
    accountReply(
      context.set,
      await d.enableStaffAccount.execute(staffOf(context), context.params.id),
    )

  const route = (roles: Parameters<Guards['staff']>[0], extra: object = {}) =>
    staffRoute(d.guards, 'staff', roles, extra)

  return routePlugin({ prefix: '/staff' })
    .get('/me', me, route(GET_STAFF_ME_ROLES))
    .get('/sessions', listSessions, route(LIST_STAFF_SESSIONS_ROLES))
    .delete('/sessions/:id', revokeSession, {
      ...route(REVOKE_STAFF_SESSION_ROLES),
      params: IdParams,
    })
    .post('/step-up', requestStepUp, { ...route(REQUEST_STEP_UP_ROLES), body: StepUpBody })
    .get('/accounts', listAccounts, { ...route(LIST_STAFF_ACCOUNTS_ROLES), query: ListQuery })
    .post('/accounts', d.idempotent({ account: staffAccountKey }, createAccount), {
      ...route(CREATE_STAFF_ACCOUNT_ROLES, { idempotent: true, stepUp: 'admin_change' }),
      body: CreateBody,
    })
    .get('/accounts/:id', getAccount, { ...route(GET_STAFF_ACCOUNT_ROLES), params: IdParams })
    .patch('/accounts/:id', updateAccount, {
      ...route(UPDATE_STAFF_ACCOUNT_ROLES, { stepUp: ['admin_change', 'staff_email'] }),
      params: IdParams,
      body: UpdateBody,
    })
    .post('/accounts/:id/lock', lockAccount, {
      ...route(LOCK_STAFF_ACCOUNT_ROLES),
      params: IdParams,
      body: ReassignBody,
    })
    .post('/accounts/:id/unlock', unlockAccount, {
      ...route(UNLOCK_STAFF_ACCOUNT_ROLES),
      params: IdParams,
    })
    .post('/accounts/:id/disable', disableAccount, {
      ...route(DISABLE_STAFF_ACCOUNT_ROLES),
      params: IdParams,
      body: ReassignBody,
    })
    .post('/accounts/:id/enable', enableAccount, {
      ...route(ENABLE_STAFF_ACCOUNT_ROLES),
      params: IdParams,
    })
}
