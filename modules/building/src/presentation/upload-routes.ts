import {
  type Idempotent,
  IdParams,
  type RouteSet,
  routePlugin,
  staffRoute,
  strictObject,
} from '@core/http'
import { ValidationError } from '@core/kernel'
import { type Guards, type StaffRole, type StaffSession, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import type { FileActor, FileModule, FilesApi, UploadPurpose } from '../contracts'
import { PURPOSE_RULES } from '../domain/purposes'

export interface UploadRouteDeps {
  files: Pick<FilesApi, 'register' | 'verify'>
  guards: Guards
  /** E-36 takes an `Idempotency-Key` (DOC-50 §8.1). */
  idempotent: Idempotent
}

/** Any staff role may call: which purpose a role may register is the rule of the purpose (DOC-37 §4), checked by `FilesApi.register`. */
const STAFF_UPLOAD_ROLES = [
  'admin',
  'manager',
  'technician',
  'guard',
] as const satisfies readonly StaffRole[]

const RegisterBody = strictObject({
  purpose: Type.String({ maxLength: 40 }),
  module: Type.Optional(Type.String({ maxLength: 20 })),
  mime: Type.String({ maxLength: 120 }),
  size: Type.Integer({ minimum: 1 }),
})

/** The key belongs to the staff account (DOC-50 §8.3). */
const staffAccount = (context: object) => ({
  kind: 'staff' as const,
  id: staffOf(context).staffId as string,
})

const actorOf = (staff: StaffSession): FileActor => ({
  accountKind: 'staff',
  accountId: staff.staffId,
  buildingId: staff.buildingId,
  scope: staff.scope,
  role: staff.role,
})

/** The module of the table of DOC-37 §4; an `import` names its own, for any other purpose the field is optional. */
function moduleOf(purpose: string, named: string | undefined): FileModule {
  if (named) return named as FileModule
  const modules = (PURPOSE_RULES as Record<string, { modules: readonly FileModule[] } | undefined>)[
    purpose
  ]?.modules
  const [only] = modules ?? []
  if (!only || modules?.length !== 1)
    throw new ValidationError([{ path: 'module', code: 'required', message: 'required' }])
  return only
}

/**
 * `/staff/uploads` (E-36, E-37; DOC-37 §6): the two calls around the client's `PUT` to the bucket. No byte passes through the
 * API. E-36 takes an `Idempotency-Key` (DOC-50 §8, P1-28): a retried registration answers the first ticket instead of making a
 * second `pending` row. E-37 is safe to repeat by itself (DR-146).
 */
export function uploadRoutes(d: UploadRouteDeps) {
  const register = async (context: {
    body: Static<typeof RegisterBody>
    request: Request
    set: RouteSet
  }) => {
    const { purpose, module, mime, size } = context.body
    const ticket = await d.files.register(actorOf(staffOf(context)), {
      purpose: purpose as UploadPurpose,
      module: moduleOf(purpose, module),
      mime,
      size,
    })
    context.set.status = 201
    return ticket
  }

  const verify = (context: { params: Static<typeof IdParams> }) =>
    d.files.verify(actorOf(staffOf(context)), context.params.id)

  const route = staffRoute(d.guards, 'files', STAFF_UPLOAD_ROLES, { byPurpose: true })

  return routePlugin({ prefix: '/staff/uploads' })
    .post('/', d.idempotent({ account: (context) => staffAccount(context) }, register), {
      ...staffRoute(d.guards, 'files', STAFF_UPLOAD_ROLES, { byPurpose: true, idempotent: true }),
      body: RegisterBody,
    })
    .post('/:id/verify', verify, { ...route, params: IdParams })
}
