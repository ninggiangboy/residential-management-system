import type { UnitContext } from '@rms/shared-types'

/** The policy table lives in `@rms/shared-types`, so the apps read the same function (DOC-12 §11.2, DOC-55 §7.1). */
export { can } from '@rms/shared-types'
export type { UnitContext }
