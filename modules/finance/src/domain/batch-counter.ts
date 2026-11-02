import type { BuildingScope } from '@rms/shared-types'

/**
 * The `batch` series of the counter (DR-10, DOC-21 §3.1): period `YYMM` of the fee month, taken in the create transaction. A
 * local port so the application layer never imports `@core/db`; the core `GaplessCounter` satisfies it structurally.
 */
export interface BatchCounter {
  next(scope: BuildingScope, series: 'batch', period: string): Promise<number>
}
