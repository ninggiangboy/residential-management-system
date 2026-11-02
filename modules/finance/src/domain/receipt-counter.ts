import type { BuildingScope } from '@rms/shared-types'

/**
 * The `receipt` series of the gapless counter (DOC-12 §9.5, DOC-22 §4.2), taken inside the caller's transaction right
 * before the receipt insert. A local port so the application layer never imports `@core/db`; the core `GaplessCounter`
 * satisfies it structurally.
 */
export interface ReceiptCounter {
  next(scope: BuildingScope, series: 'receipt', period: string): Promise<number>
}
