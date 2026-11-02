import type { ActiveIntentProbe } from '@mod/building/contracts'
import type { FinanceApi } from '../../contracts'

/**
 * `building` declares the question "is an intent active?" and `finance` answers it here, so the module graph stays acyclic
 * (DOC-12 §4.4, DOC-36 §7.3, DR-126). Only `apps/api` imports this file.
 */
export function activeIntentProbe(finance: Pick<FinanceApi, 'hasActiveIntent'>): ActiveIntentProbe {
  return { hasActive: (buildingId, provider) => finance.hasActiveIntent(buildingId, provider) }
}
