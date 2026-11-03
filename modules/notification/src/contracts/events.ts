import type { Params, SourceKind, TemplateKey } from '@rms/shared-types'

/**
 * The two messages `notification` writes to its own outbox (DOC-09 §6.7, DOC-31 §2.4). `push_requested` is a command of the
 * retry class `push`; `staff_inbox_created` is the event `realtime` turns into `inbox.created` (DOC-52).
 */
export const NOTIFICATION_EVENTS = {
  pushRequested: 'notification.push_requested.v1',
  staffInboxCreated: 'notification.staff_inbox_created.v1',
} as const

/** One recipient of a push command: each carries its own unit (DR-301, DOC-31 §2.4). */
export interface PushRecipient {
  accountKind: 'resident' | 'staff'
  accountId: string
  unitId: string | null
}

/**
 * `notification.push_requested.v1` (DOC-09 §6.7, DOC-31 §6.1): a command that asks for a push to up to 100 accounts. Each
 * recipient carries its own `unitId` because the members of 500 units share one message; the top-level `unitId` is removed
 * (DR-301, DOC-31 §2.4).
 */
export interface PushRequestedPayload {
  buildingId: string
  templateKey: TemplateKey
  sourceKind: SourceKind
  sourceId: string
  params: Params
  channel: 'default' | 'urgent'
  route: string
  entityId: string | null
  recipients: PushRecipient[]
}

/** `notification.staff_inbox_created.v1` (DOC-09 §6.7, DOC-31 §4.1 step 5): one row per staff entry, for `realtime`. */
export interface StaffInboxCreatedPayload {
  buildingId: string
  staffId: string
  entryId: string
  templateKey: TemplateKey
}
