import { describedEnum, IdParams, routePlugin, staffRoute, strictObject } from '@core/http'
import { ValidationError } from '@core/kernel'
import { type Guards, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import {
  CHANGE_MEMBERSHIP_ROLES,
  type ChangeMembership,
  type MembershipEdit,
} from '../application/use-cases/change-membership'
import type { MembershipRecord } from '../domain/membership'

export interface MembershipRouteDeps {
  changeMembership: ChangeMembership
  guards: Guards
}

/** Exactly one of the three keys (DR-139); `memberType` is only the two a retype may reach. */
const UpdateBody = strictObject({
  status: Type.Optional(
    describedEnum(
      {
        locked:
          'Lock the membership, the owner one included; the owner cannot undo a lock set by a manager',
        active: 'Unlock a locked membership',
        removed:
          'Remove a membership other than the owner one; the owner is removed only by a transfer',
      },
      'The new status of the membership. Send exactly one of `status`, `memberType` and `canPay`.',
    ),
  ),
  memberType: Type.Optional(
    describedEnum(
      { family: 'A family member', tenant: 'A tenant' },
      'Retype between family member and tenant.',
    ),
  ),
  canPay: Type.Optional(
    Type.Boolean({ description: 'Whether the membership may pay fees. Only for a tenant' }),
  ),
})

function editOf(body: Static<typeof UpdateBody>): MembershipEdit {
  const keys = Object.keys(body).filter((key) => body[key as keyof typeof body] !== undefined)
  if (keys.length !== 1)
    throw new ValidationError([
      { path: '', code: 'one_change_only', message: 'exactly one of status, memberType, canPay' },
    ])
  if (body.status !== undefined) return { status: body.status }
  if (body.memberType !== undefined) return { memberType: body.memberType }
  return { canPay: body.canPay as boolean }
}

/** The `MembershipDto` of DOC-51 §10 (`startedAt` is `created_at`). */
const membershipBody = (row: MembershipRecord) => ({
  membershipId: row.id,
  accountId: row.accountId,
  unitId: row.unitId,
  memberType: row.memberType,
  canPay: row.canPay,
  status: row.status,
  lockedBy: row.lockedBy,
  startedAt: row.createdAt.toISOString(),
})

/** `PATCH /staff/memberships/{id}` (E-69; DOC-27 §6): one change per request, decided by the aggregate. */
export function membershipRoutes(d: MembershipRouteDeps) {
  const update = async (context: {
    params: Static<typeof IdParams>
    body: Static<typeof UpdateBody>
  }) =>
    membershipBody(
      await d.changeMembership.execute(staffOf(context), context.params.id, editOf(context.body)),
    )

  return routePlugin({ prefix: '/staff/memberships' }).patch('/:id', update, {
    ...staffRoute(d.guards, 'residency', CHANGE_MEMBERSHIP_ROLES, {
      endpoint: 'E-69',
      operationId: 'updateMembership',
      summary: 'Update a membership',
      description:
        'Locks, unlocks, removes or retypes one membership, or sets `canPay`. The owner has their own household endpoints for the same actions.',
    }),
    params: IdParams,
    body: UpdateBody,
  })
}
