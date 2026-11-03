import { requireRole } from '@core/kernel'
import {
  type BuildingScope,
  STAFF_ROLES,
  type StaffContext,
  type UnitContext,
} from '@rms/shared-types'
import type { AccountKind } from '../domain/inbox-entry'

/** The account whose inbox a call reads or marks, in the building its token or membership names (DOC-31 §4.4). */
export interface InboxReader {
  readonly scope: BuildingScope
  readonly kind: AccountKind
  readonly accountId: string
}

/** A resident reader: the building comes from the membership of `X-Unit-Id`, never from the request (DOC-31 §4.4 E-78). */
export const residentReader = (unit: UnitContext): InboxReader => ({
  scope: unit.scope,
  kind: 'resident',
  accountId: unit.accountId,
})

/** A staff reader: every staff role has an inbox (DOC-31 §4.4 E-76), so the roles are the whole list. */
export function staffReader(staff: StaffContext): InboxReader {
  requireRole(staff, STAFF_ROLES)
  return { scope: staff.scope, kind: 'staff', accountId: staff.staffId }
}
