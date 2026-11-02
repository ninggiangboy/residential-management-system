import type { BuildingScope } from '@rms/shared-types'
import type { ChargeRecord, FeeBatchRecord } from './fee-batch'

/** The reads of a batch and its charges (DOC-21 §3); the screens of P2-15 and P2-16 build on them. */
export interface FeeBatchReader {
  findBatch(scope: BuildingScope, batchId: string): Promise<FeeBatchRecord | null>
  chargesOf(scope: BuildingScope, batchId: string): Promise<readonly ChargeWithLines[]>
}

export interface ChargeWithLines extends ChargeRecord {
  readonly lines: ReadonlyArray<{
    readonly position: number
    readonly kind: 'fee' | 'adjustment'
    readonly itemName: { readonly vi: string; readonly en?: string }
    readonly quantity: string
    readonly unitPrice: number
    readonly amount: number
    readonly note: string | null
  }>
}
