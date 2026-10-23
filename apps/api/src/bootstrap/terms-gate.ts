import { ForbiddenError } from '@core/kernel'
import type { BuildingApi } from '@mod/building/contracts'

/**
 * The terms gate of DOC-35 §9.2: a resident whose building has published a version that the account has not accepted is refused
 * with 403 `terms_required`, listing what to accept. One statement, not cached, because FR-41.1 wants the very next request after
 * a publish refused and two API containers cannot share an invalidation (DR-125). A building with no published version requires
 * nothing (AD-37). The `unit(capability)` guard of P1-12 calls it after it knows the building from the membership; a token-only
 * route (`/me`, `/me/sessions`, `/me/terms*`, `/me/account/deletion`) has no building and no gate by construction (DR-143).
 */
export function createTermsGate(building: Pick<BuildingApi, 'missingTerms'>) {
  return async (accountId: string, buildingId: string): Promise<void> => {
    const required = await building.missingTerms(accountId, buildingId)
    if (required.length === 0) return
    throw new ForbiddenError('terms_required', 'Please accept the updated terms to continue.', {
      details: { required },
    })
  }
}

export type TermsGate = ReturnType<typeof createTermsGate>
