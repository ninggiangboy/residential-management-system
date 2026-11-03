import type { SourceKind, TemplateKey } from '@rms/shared-types'
import type { AccountKind } from './inbox-entry'

/** The states of `push_ticket.status` (DOC-17 §6.3). */
export type PushTicketStatus = 'pending' | 'ok' | 'failed' | 'unknown'

/** One ticket `SendExpoPush` writes after an Expo answer (DOC-31 §6.2 step 7). */
export interface NewPushTicket {
  readonly id: string
  readonly messageId: string
  readonly deviceTokenId: string
  readonly accountKind: AccountKind
  readonly accountId: string
  readonly templateKey: TemplateKey
  readonly sourceKind: SourceKind
  readonly sourceId: string
  readonly receiptId: string | null
  readonly status: PushTicketStatus
  readonly error: string | null
  readonly nextCheckAt: Date | null
}

/** One claimed ticket `push_receipts` asks Expo about (DOC-31 §7 step 1, OPM-S22). */
export interface ClaimedPushTicket {
  readonly id: string
  readonly receiptId: string
  readonly deviceTokenId: string
}

/** The outcome of one receipt (DOC-31 §7 step 3). */
export interface PushReceiptOutcome {
  readonly status: 'ok' | 'failed' | 'unknown'
  readonly error: string | null
}
