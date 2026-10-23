import { routePlugin, strictObject } from '@core/http'
import { ValidationError } from '@core/kernel'
import { type Guards, type StaffRole, type StaffSession, staffOf } from '@rms/shared-types'
import { Type } from '@sinclair/typebox'
import type { FileActor, FileModule, FilesApi, UploadPurpose } from '../contracts'
import { PURPOSE_RULES } from '../domain/purposes'

export interface UploadRouteDeps {
  files: Pick<FilesApi, 'register' | 'verify'>
  guards: Guards
}

/** Any staff role may call: which purpose a role may register is the rule of the purpose (DOC-37 §4), checked by `FilesApi.register`. */
const STAFF_UPLOAD_ROLES = [
  'admin',
  'manager',
  'technician',
  'guard',
] as const satisfies readonly StaffRole[]

const audience = (roles: readonly string[]) => ({
  detail: { tags: ['files'], 'x-audience': { kind: 'staff', roles, byPurpose: true } },
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
 * API. The `Idempotency-Key` of E-36 joins with the idempotency plugin of DOC-50 §8; until then a retried registration makes a
 * second `pending` row, which the orphan job removes after 24 h.
 */
export function uploadRoutes(d: UploadRouteDeps) {
  return routePlugin({ prefix: '/staff/uploads' })
    .post(
      '/',
      async (context) => {
        const { purpose, module, mime, size } = context.body
        const ticket = await d.files.register(actorOf(staffOf(context)), {
          purpose: purpose as UploadPurpose,
          module: moduleOf(purpose, module),
          mime,
          size,
        })
        context.set.status = 201
        return ticket
      },
      {
        ...d.guards.staff(STAFF_UPLOAD_ROLES),
        body: strictObject({
          purpose: Type.String({ maxLength: 40 }),
          module: Type.Optional(Type.String({ maxLength: 20 })),
          mime: Type.String({ maxLength: 120 }),
          size: Type.Integer({ minimum: 1 }),
        }),
        ...audience(STAFF_UPLOAD_ROLES),
      },
    )
    .post(
      '/:id/verify',
      (context) => d.files.verify(actorOf(staffOf(context)), context.params.id),
      {
        ...d.guards.staff(STAFF_UPLOAD_ROLES),
        params: strictObject({ id: Type.String({ format: 'uuid' }) }),
        ...audience(STAFF_UPLOAD_ROLES),
      },
    )
}
