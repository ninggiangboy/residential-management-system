import type { BuildingScope } from '@rms/shared-types'
import type { ResidentProfileRecord, ResidentProfileTransition } from './resident-profile'

/** What the Manager's form gives the profile of a person it adds (DOC-27 §5.1). */
export interface ProfileSeed {
  accountId: string
  fullName: string
  email: string | null
  note: string | null
}

/** A person's profile in one building; the key is `(building, account)` (DR-106). */
export interface ResidentProfileRepository {
  /** `null` for an account with no profile here: a person of another building is 404 (DR-136). */
  find(scope: BuildingScope, accountId: string): Promise<ResidentProfileRecord | null>
  /**
   * Every first membership of an account in a building creates the profile (DR-136): `ON CONFLICT DO NOTHING` keeps the first
   * name, and an `email` or `note` the form gave fills a stored empty one and never replaces a value. `true` when a row was
   * inserted or a field filled, which is when the Manager's add also writes `residency.profile.update`.
   */
  ensure(scope: BuildingScope, seed: ProfileSeed, now: Date): Promise<boolean>
  /** One statement on `version`; `null` when another edit won (409 `version_conflict`). */
  apply(
    scope: BuildingScope,
    transition: ResidentProfileTransition,
    now: Date,
  ): Promise<ResidentProfileRecord | null>
}
