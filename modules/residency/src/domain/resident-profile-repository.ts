import type { BuildingScope } from '@rms/shared-types'
import type { ResidentProfileRecord, ResidentProfileTransition } from './resident-profile'

/** A person's profile in one building; the key is `(building, account)` (DR-106). */
export interface ResidentProfileRepository {
  /** `null` for an account with no profile here: a person of another building is 404 (DR-136). */
  find(scope: BuildingScope, accountId: string): Promise<ResidentProfileRecord | null>
  /** One statement on `version`; `null` when another edit won (409 `version_conflict`). */
  apply(
    scope: BuildingScope,
    transition: ResidentProfileTransition,
    now: Date,
  ): Promise<ResidentProfileRecord | null>
}
