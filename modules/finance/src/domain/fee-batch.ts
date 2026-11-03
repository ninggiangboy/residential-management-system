import type { LocalDate, Money } from '@rms/shared-types'
import type { ChargeLine } from './charge-line'
import { InvalidTransitionError } from './errors'

/** A bilingual name: `vi` required, `en` optional (DOC-14 §2.2, `platform.is_bilingual`). */
export interface BilingualName {
  readonly vi: string
  readonly en?: string
}

export type FeeBatchStatus = 'draft' | 'published' | 'closed' | 'recalled'
export type ChargeStatus = 'draft' | 'open' | 'paid' | 'void'

/** One batch of one fee month (DOC-15 §5.1). */
export interface FeeBatchRecord {
  readonly id: string
  readonly code: string
  readonly name: BilingualName
  readonly feeMonth: LocalDate
  readonly dueDate: LocalDate
  readonly status: FeeBatchStatus
  readonly version: number
  readonly createdBy: string
  readonly createdAt: Date
  /** The recalled batch a re-issued draft corrects (DOC-21 §3.7); absent or `null` otherwise. */
  readonly replacesBatchId?: string | null
}

/** What one unit owes in one batch (DOC-15 §5.2), with the status of its batch for the draft checks of DOC-21 §3.2. */
export interface ChargeRecord {
  readonly id: string
  readonly batchId: string
  readonly batchStatus: FeeBatchStatus
  readonly unitId: string
  readonly unitCode: string
  readonly amount: Money
  readonly status: ChargeStatus
  readonly version: number
}

/** A new draft charge and its lines, positions 1… in the given order (DOC-21 §3.2). */
export interface DraftChargeInsert {
  readonly id: string
  readonly batchId: string
  readonly unitId: string
  readonly unitCode: string
  readonly amount: Money
  readonly lines: readonly (ChargeLine & { readonly id: string })[]
}

/** `fee_month` is a date and the first day of its month (DOC-21 §3.1 rule 1, `ck_fee_batch_fee_month`). */
export const isFirstOfMonth = (day: LocalDate): boolean => day.endsWith('-01')

/** `vi` not blank after trimming, `en` dropped when blank (DOC-15 §5.1 `ck_fee_batch_name`, `platform.is_bilingual`). */
export function normalizeBatchName(name: BilingualName): BilingualName | null {
  const vi = name.vi.trim()
  const en = name.en?.trim() ?? ''
  if (vi === '') return null
  return en === '' ? { vi } : { vi, en }
}

/** A charge is edited only while it and its batch are drafts (DOC-21 §3.2); otherwise 409 `invalid_transition`. */
export function assertDraft(charge: ChargeRecord, action: string): void {
  if (charge.batchStatus !== 'draft')
    throw new InvalidTransitionError('fee_batch', charge.batchStatus, action)
  if (charge.status !== 'draft') throw new InvalidTransitionError('charge', charge.status, action)
}
