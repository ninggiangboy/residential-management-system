import {
  API_PREFIX,
  describedEnum,
  type Idempotent,
  IdParams,
  type RouteInfo,
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
import { UPDATE_STAFF_ME_ROLES, type UpdateStaffMe } from '../application/use-cases/update-staff-me'

export interface StaffRouteDeps {
  updateStaffMe: UpdateStaffMe
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
  action: describedEnum(
    {
      gateway_config: 'Change the payment gateway configuration',
      admin_change: 'Create an admin account or promote someone to admin',
      staff_email: 'Change the email of a staff account',
    },
    'The sensitive action the code is for. The code works for this action only.',
  ),
})

const Role = describedEnum(
  {
    admin: 'Full access, including staff accounts and the payment gateway',
    manager: 'Runs the building day to day',
    technician: 'Works on the tickets assigned to them',
    guard: 'Front-gate security',
  },
  'The role of the staff member.',
)
const Status = describedEnum(
  {
    invited: 'Created and mailed a link; has not set a password yet',
    active: 'Can sign in',
    locked: 'Locked by an admin or manager; cannot sign in',
    disabled: 'A former staff member; the email stays reserved',
  },
  'The status of the staff account.',
)
const Language = describedEnum({ vi: 'Vietnamese', en: 'English' }, 'The interface language.')
const ProofBody = strictObject(
  {
    password: Type.String({
      minLength: 1,
      maxLength: 128,
      description: 'The password of the signed-in admin',
    }),
    code: Type.String({
      pattern: '^[0-9]{6}$',
      description: 'The six-digit code mailed by `requestStepUp` for the action',
    }),
  },
  { description: 'The proof of a sensitive action (a password and a step-up code)' },
)
const FullName = Type.String({ minLength: 1, maxLength: 120, description: 'The full name' })
const Email = Type.String({ format: 'email', maxLength: 254, description: 'The email address' })

const UpdateMeBody = strictObject({
  fullName: Type.Optional(Type.String({ minLength: 1, description: 'The own full name' })),
  language: Type.Optional(Language),
  pushEnabled: Type.Optional(
    Type.Boolean({ description: 'Whether push notifications are on for this account' }),
  ),
  avatarFileId: Type.Optional(
    Type.Union([Type.String({ format: 'uuid' }), Type.Null()], {
      description: 'The id of a verified `avatar` upload; `null` removes the avatar',
    }),
  ),
})

const ListQuery = strictObject({
  page: Type.Optional(
    Type.String({ pattern: '^[0-9]{1,5}$', description: 'The page number, from 1 (default 1)' }),
  ),
  pageSize: Type.Optional(
    Type.String({ pattern: '^[0-9]{1,3}$', description: 'Rows per page, 1…50 (default 10)' }),
  ),
  role: Type.Optional(Role),
  status: Type.Optional(Status),
  q: Type.Optional(
    Type.String({
      maxLength: 100,
      description: 'Matches the name (case and diacritics ignored) or the start of the email',
    }),
  ),
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
  reassignTo: Type.Optional(
    Type.String({
      format: 'uuid',
      description:
        'With `role`: an active technician or guard who takes over the open tickets of the account (admin only)',
    }),
  ),
  reason: Type.Optional(
    Type.String({
      maxLength: 1000,
      description:
        'Why the open tickets are reassigned, 5…500 characters. Required with `reassignTo`',
    }),
  ),
  stepUp: Type.Optional(ProofBody),
})
const ReassignBody = Type.Optional(
  strictObject({
    reassignTo: Type.Optional(
      Type.String({
        format: 'uuid',
        description:
          'Admin only: an active technician or guard who takes over every open ticket of the account in the same transaction',
      }),
    ),
    reason: Type.Optional(
      Type.String({
        maxLength: 1000,
        description:
          'Why the open tickets are reassigned, 5…500 characters. Required with `reassignTo`',
      }),
    ),
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
  const me = async (context: { request: Request; set: RouteSet }) => {
    const profile = await d.staffQueries.me(staffOf(context))
    const etag = quoted(profile.version)
    context.set.headers.etag = etag
    context.set.headers['cache-control'] = 'private, no-cache'
    if (context.request.headers.get('if-none-match') === etag) {
      context.set.status = 304
      return undefined
    }
    return profile
  }

  const updateMe = async (context: {
    body: Static<typeof UpdateMeBody>
    request: Request
    set: RouteSet
  }) => {
    const profile = await d.updateStaffMe.execute(staffOf(context), {
      ...context.body,
      version: versionOf(context.request.headers.get('if-match')),
    })
    context.set.headers.etag = quoted(profile.version)
    return profile
  }

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

  const route = (roles: Parameters<Guards['staff']>[0], info: RouteInfo) =>
    staffRoute(d.guards, 'staff', roles, info)

  return routePlugin({ prefix: '/staff' })
    .get(
      '/me',
      me,
      route(GET_STAFF_ME_ROLES, {
        endpoint: 'E-30',
        operationId: 'getStaffMe',
        summary: 'Get the signed-in staff member',
        description:
          'The account of the signed-in staff member, used by the shell of the web CMS and the staff app.',
      }),
    )
    .patch('/me', updateMe, {
      ...route(UPDATE_STAFF_ME_ROLES, {
        endpoint: 'E-31',
        operationId: 'updateStaffMe',
        summary: 'Update the signed-in staff member',
        description:
          'Edits the own name, language, push setting and avatar. The email and the role are never changed here: the email only through the staff account update with step-up, the role only by an admin.',
      }),
      body: UpdateMeBody,
    })
    .get(
      '/sessions',
      listSessions,
      route(LIST_STAFF_SESSIONS_ROLES, {
        endpoint: 'E-32',
        operationId: 'listStaffSessions',
        summary: 'List my staff sessions',
        description:
          'The live sessions of the signed-in staff member, with the current one marked.',
      }),
    )
    .delete('/sessions/:id', revokeSession, {
      ...route(REVOKE_STAFF_SESSION_ROLES, {
        endpoint: 'E-33',
        operationId: 'revokeStaffSession',
        summary: 'Revoke one of my staff sessions',
        description: 'Ends one of the own sessions, or the current one, which equals a sign-out.',
      }),
      params: IdParams,
    })
    .post('/step-up', requestStepUp, {
      ...route(REQUEST_STEP_UP_ROLES, {
        endpoint: 'E-38',
        operationId: 'requestStepUp',
        summary: 'Request a step-up code',
        description:
          'The admin asks for the one-time code that proves a sensitive action. The code is mailed to the admin own address, is valid for 10 minutes, can be used once and is bound to the admin and to the action.',
      }),
      body: StepUpBody,
    })
    .get('/accounts', listAccounts, {
      ...route(LIST_STAFF_ACCOUNTS_ROLES, {
        endpoint: 'E-39',
        operationId: 'listStaffAccounts',
        summary: 'List staff accounts',
        description: 'The staff accounts of the building, with filters and cursor pagination.',
      }),
      query: ListQuery,
    })
    .post('/accounts', d.idempotent({ account: staffAccountKey }, createAccount), {
      ...route(CREATE_STAFF_ACCOUNT_ROLES, {
        endpoint: 'E-40',
        operationId: 'createStaffAccount',
        summary: 'Create a staff account',
        description:
          'Creates a staff account in the status `invited` and mails the set-password link. Needs an `Idempotency-Key`, and a step-up code for `admin_change` when the role is `admin`.',
        idempotent: true,
        stepUp: 'admin_change',
      }),
      body: CreateBody,
    })
    .get('/accounts/:id', getAccount, {
      ...route(GET_STAFF_ACCOUNT_ROLES, {
        endpoint: 'E-41',
        operationId: 'getStaffAccount',
        summary: 'Get a staff account',
        description:
          'One staff account. The `ETag` of the answer is the value to send in `If-Match` when updating it.',
      }),
      params: IdParams,
    })
    .patch('/accounts/:id', updateAccount, {
      ...route(UPDATE_STAFF_ACCOUNT_ROLES, {
        endpoint: 'E-42',
        operationId: 'updateStaffAccount',
        summary: 'Update a staff account',
        description:
          'Edits the name, language, role or email of a staff account. Needs `If-Match`; a promotion to `admin` needs a step-up code for `admin_change`, an email change one for `staff_email`.',
        stepUp: ['admin_change', 'staff_email'],
      }),
      params: IdParams,
      body: UpdateBody,
    })
    .post('/accounts/:id/lock', lockAccount, {
      ...route(LOCK_STAFF_ACCOUNT_ROLES, {
        endpoint: 'E-43',
        operationId: 'lockStaffAccount',
        summary: 'Lock a staff account',
        description:
          'Locks a staff account so it cannot sign in and every session ends. A manager can lock only technician and guard accounts; an admin any account except their own. Open tickets are handed to `reassignTo`.',
      }),
      params: IdParams,
      body: ReassignBody,
    })
    .post('/accounts/:id/unlock', unlockAccount, {
      ...route(UNLOCK_STAFF_ACCOUNT_ROLES, {
        endpoint: 'E-44',
        operationId: 'unlockStaffAccount',
        summary: 'Unlock a staff account',
        description:
          'Lifts either kind of lock at once: the manual `locked` status and the temporary lock after failed sign-ins.',
      }),
      params: IdParams,
    })
    .post('/accounts/:id/disable', disableAccount, {
      ...route(DISABLE_STAFF_ACCOUNT_ROLES, {
        endpoint: 'E-45',
        operationId: 'disableStaffAccount',
        summary: 'Disable a staff account',
        description: 'Deactivates a former staff member. The email stays reserved.',
      }),
      params: IdParams,
      body: ReassignBody,
    })
    .post('/accounts/:id/enable', enableAccount, {
      ...route(ENABLE_STAFF_ACCOUNT_ROLES, {
        endpoint: 'E-46',
        operationId: 'enableStaffAccount',
        summary: 'Enable a staff account',
        description: 'Re-activates a disabled staff account.',
      }),
      params: IdParams,
    })
}
