import type { BuildingId, BuildingScope, StaffId } from './ids'
import type { StaffRole } from './people'

/**
 * The request context of a staff call, built by the `staff(...roles)` guard from the verified token and the account row
 * (DOC-12 §5.3, §11.1). It lives here, not in `identity`, because `audit` and `building` take it as an argument and a module
 * may import another's contracts only: `identity` re-uses this type in its own contract.
 */
export interface StaffContext {
  readonly buildingId: BuildingId
  readonly staffId: StaffId
  readonly role: StaffRole
  readonly scope: BuildingScope
}
