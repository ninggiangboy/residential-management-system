import type { StaffRole } from '@rms/shared-types'

/** The six event types of the staff stream (DOC-52 §6, DR-75). A new type is a row there, a value in `ck_events_type`, a mapping and a line in the web map. */
export const REALTIME_EVENT_TYPES = [
  'inbox.created',
  'ticket.created',
  'ticket.changed',
  'money_log.opened',
  'export.ready',
  'session.revoked',
] as const
export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number]

/** Who receives an event: one account, or the staff roles of the building; never both (`ck_events_target`, DOC-52 §7). */
export type RealtimeTarget = { accountId: string } | { roles: readonly StaffRole[] }

/** What a producer's `integrations/realtime.ts` says about one of its events (DOC-52 §9.1, DOC-12 §4.4). */
export interface RealtimeBuilt {
  buildingId: string
  target: RealtimeTarget
  /** `session.revoked` only: the streams of this session close after the event (DOC-52 §6.6). */
  closeSessionId?: string
  event: { type: RealtimeEventType; data: Record<string, unknown> }
}

export interface RealtimeMapping<P = never> {
  /** `realtime.sse_on_finance_money_unposted` (DOC-09 §3.3). */
  readonly handler: string
  /** The outbox event type, e.g. `finance.money_unposted.v1`. */
  readonly eventType: string
  /** `null` = nothing to send (a resident's `session_revoked`). Pure; ids, codes and enumerated words only (DOC-52 §6). */
  build(payload: P, meta: { messageId: string }): RealtimeBuilt | null
}

/** Payloads of DOC-52 §6.1…§6.6: ids, codes and enumerated words, never a name, phone, amount or text. */
export interface InboxCreatedData {
  entryId: string
  templateKey: string
}
export interface TicketCreatedData {
  ticketId: string
  code: string
  unitId: string
  toStatus: string
}
export interface TicketChangedData {
  ticketId: string
  code: string
  unitId: string
  change: 'assigned' | 'status_changed' | 'message_added' | 'rated'
  fromStatus: string
  toStatus: string
}
export interface MoneyLogOpenedData {
  kind: 'gateway_event' | 'statement_line'
  rowId: string
  outcome: string
}
export interface ExportReadyData {
  exportId: string
  kind: string
  format: 'xlsx' | 'pdf'
  fileId: string
  expiresAt: string
}
export interface SessionRevokedData {
  sessionId: string
  reason: string
}
