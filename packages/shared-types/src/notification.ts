/**
 * The notification catalog of DOC-31 (DR-303): the 21 template keys, the params each declares, the push channel and the
 * closed list of tap targets (`PUSH_ROUTES`). It lives here, not in a module, because the server, the two apps and the
 * web CMS read the same table (DOC-31 §2.2). This package is a leaf: the file imports nothing.
 */

/** The 21 template keys of DOC-31 §3.2; `staff.invited` is not one (DR-53, DR-116). */
export const TEMPLATE_KEYS = [
  'fee.batch_published',
  'fee.batch_recalled',
  'fee.batch_due_extended',
  'fee.charge_voided',
  'fee.reminder',
  'payment.received',
  'payment.voided',
  'finance.money_unposted',
  'staff.step_up_done',
  'member.added',
  'ticket.new_unassigned',
  'ticket.assigned',
  'ticket.status_changed',
  'ticket.commented',
  'ticket.rejected',
  'ticket.awaiting_close',
  'notice.published',
  'vehicle.pending_review',
  'vehicle.approved',
  'vehicle.rejected',
  'report.export_ready',
] as const
export type TemplateKey = (typeof TEMPLATE_KEYS)[number]

/** The object a source event is about (`inbox_entry.source_kind`, DOC-31 §2.2, DR-299). */
export const SOURCE_KINDS = [
  'batch',
  'charge',
  'debt_reminder',
  'payment',
  'gateway_event',
  'statement_line',
  'ticket',
  'vehicle',
  'notice',
  'membership',
  'unit',
  'export',
  'step_up',
] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

/** A template param (DOC-31 §3.3); `action` and `actorName` never reach a push (DR-52). */
export const PARAM_NAMES = [
  'batchCode',
  'feeMonth',
  'dueDate',
  'ticketCode',
  'status',
  'noticeTitle',
  'action',
  'actorName',
] as const
export type ParamName = (typeof PARAM_NAMES)[number]

/** A bilingual value only for `noticeTitle`; every other param is a stored string (DOC-31 §3.3, DR-52). */
export type ParamValue = string | { vi: string; en?: string }
export type Params = Readonly<Record<string, ParamValue>>

/** The params a pushed text may hold (DOC-31 §3.3, DR-52); no amount, person, phone, ticket text or unit code. */
export const PUSH_SAFE_PARAMS = [
  'batchCode',
  'feeMonth',
  'dueDate',
  'ticketCode',
  'status',
  'noticeTitle',
] as const

/** The Android channel of a push (DOC-31 §6.2, DR-52); `by_notice` follows the notice's own urgency (DOC-31 §3.2). */
export type PushChannel = 'default' | 'urgent' | 'by_notice'

/** The two apps a tap may open (DOC-31 §6.5, DR-177, DR-193); `entity` says the route takes `route/entityId`. */
export const PUSH_ROUTES = {
  resident: [
    { route: '/', entity: false },
    { route: '/fees', entity: false },
    { route: '/fees/history', entity: false },
    { route: '/requests', entity: true },
    { route: '/notices', entity: true },
    { route: '/unit/vehicles', entity: false },
    { route: '/inbox', entity: false },
  ],
  staff: [
    { route: '/inbox', entity: false },
    { route: '/tickets', entity: true },
    { route: '/jobs', entity: true },
    { route: '/vehicles', entity: true },
  ],
} as const
export type NotificationAudience = keyof typeof PUSH_ROUTES

/** A route of the closed list of §6.5. */
export type PushRoute =
  | (typeof PUSH_ROUTES)['resident'][number]['route']
  | (typeof PUSH_ROUTES)['staff'][number]['route']

/** Whether the app of `audience` may open `route` (DOC-31 §6.5, NT-04). */
export function isPushRoute(audience: NotificationAudience, route: string): boolean {
  return PUSH_ROUTES[audience].some((entry) => entry.route === route)
}

/** One row of the catalog of DOC-31 §3.2; `webPath` is the web CMS bell path (`{id}` = source id, staff rows). */
export interface TemplateDef {
  readonly key: TemplateKey
  readonly audience: NotificationAudience
  readonly params: readonly ParamName[]
  readonly push: false | { readonly channel: PushChannel }
  readonly target: { readonly route: PushRoute; readonly entity: 'none' | 'source' }
  readonly webPath: string | null
  readonly phase: 'P2' | 'P4' | 'P5' | 'P6'
}

/** The 21 rows of DOC-31 §3.2, exactly as the table reads (DR-303). */
export const NOTIFICATION_TEMPLATES: Readonly<Record<TemplateKey, TemplateDef>> = {
  'fee.batch_published': {
    key: 'fee.batch_published',
    audience: 'resident',
    params: ['batchCode', 'feeMonth'],
    push: { channel: 'default' },
    target: { route: '/fees', entity: 'none' },
    webPath: null,
    phase: 'P2',
  },
  'fee.batch_recalled': {
    key: 'fee.batch_recalled',
    audience: 'resident',
    params: ['batchCode', 'feeMonth'],
    push: { channel: 'default' },
    target: { route: '/fees', entity: 'none' },
    webPath: null,
    phase: 'P2',
  },
  'fee.batch_due_extended': {
    key: 'fee.batch_due_extended',
    audience: 'resident',
    params: ['batchCode', 'dueDate'],
    push: { channel: 'default' },
    target: { route: '/fees', entity: 'none' },
    webPath: null,
    phase: 'P2',
  },
  'fee.charge_voided': {
    key: 'fee.charge_voided',
    audience: 'resident',
    params: ['feeMonth'],
    push: { channel: 'default' },
    target: { route: '/fees', entity: 'none' },
    webPath: null,
    phase: 'P2',
  },
  'fee.reminder': {
    key: 'fee.reminder',
    audience: 'resident',
    params: [],
    push: { channel: 'default' },
    target: { route: '/fees', entity: 'none' },
    webPath: null,
    phase: 'P2',
  },
  'payment.received': {
    key: 'payment.received',
    audience: 'resident',
    params: [],
    push: { channel: 'urgent' },
    target: { route: '/fees/history', entity: 'none' },
    webPath: null,
    phase: 'P2',
  },
  'payment.voided': {
    key: 'payment.voided',
    audience: 'resident',
    params: [],
    push: { channel: 'default' },
    target: { route: '/fees/history', entity: 'none' },
    webPath: null,
    phase: 'P2',
  },
  'finance.money_unposted': {
    key: 'finance.money_unposted',
    audience: 'staff',
    params: [],
    push: { channel: 'default' },
    target: { route: '/inbox', entity: 'none' },
    webPath: '/transactions?tab=money-log',
    phase: 'P2',
  },
  'staff.step_up_done': {
    key: 'staff.step_up_done',
    audience: 'staff',
    params: ['action', 'actorName'],
    push: false,
    target: { route: '/inbox', entity: 'none' },
    webPath: '/building',
    phase: 'P2',
  },
  'member.added': {
    key: 'member.added',
    audience: 'resident',
    params: [],
    push: { channel: 'default' },
    target: { route: '/', entity: 'none' },
    webPath: null,
    phase: 'P2',
  },
  'ticket.new_unassigned': {
    key: 'ticket.new_unassigned',
    audience: 'staff',
    params: ['ticketCode'],
    push: { channel: 'default' },
    target: { route: '/tickets', entity: 'source' },
    webPath: '/tickets/{id}',
    phase: 'P4',
  },
  'ticket.assigned': {
    key: 'ticket.assigned',
    audience: 'staff',
    params: ['ticketCode'],
    push: { channel: 'default' },
    target: { route: '/jobs', entity: 'source' },
    webPath: null,
    phase: 'P4',
  },
  'ticket.status_changed': {
    key: 'ticket.status_changed',
    audience: 'resident',
    params: ['ticketCode', 'status'],
    push: { channel: 'default' },
    target: { route: '/requests', entity: 'source' },
    webPath: null,
    phase: 'P4',
  },
  'ticket.commented': {
    key: 'ticket.commented',
    audience: 'resident',
    params: ['ticketCode'],
    push: { channel: 'default' },
    target: { route: '/requests', entity: 'source' },
    webPath: null,
    phase: 'P4',
  },
  'ticket.rejected': {
    key: 'ticket.rejected',
    audience: 'staff',
    params: ['ticketCode'],
    push: { channel: 'default' },
    target: { route: '/tickets', entity: 'source' },
    webPath: '/tickets/{id}',
    phase: 'P4',
  },
  'ticket.awaiting_close': {
    key: 'ticket.awaiting_close',
    audience: 'staff',
    params: ['ticketCode'],
    push: { channel: 'default' },
    target: { route: '/tickets', entity: 'source' },
    webPath: '/tickets/{id}',
    phase: 'P4',
  },
  'notice.published': {
    key: 'notice.published',
    audience: 'resident',
    params: ['noticeTitle'],
    push: { channel: 'by_notice' },
    target: { route: '/notices', entity: 'source' },
    webPath: '/notices',
    phase: 'P4',
  },
  'vehicle.pending_review': {
    key: 'vehicle.pending_review',
    audience: 'staff',
    params: [],
    push: { channel: 'default' },
    target: { route: '/vehicles', entity: 'source' },
    webPath: '/vehicles',
    phase: 'P5',
  },
  'vehicle.approved': {
    key: 'vehicle.approved',
    audience: 'resident',
    params: [],
    push: { channel: 'default' },
    target: { route: '/unit/vehicles', entity: 'none' },
    webPath: null,
    phase: 'P5',
  },
  'vehicle.rejected': {
    key: 'vehicle.rejected',
    audience: 'resident',
    params: [],
    push: { channel: 'default' },
    target: { route: '/unit/vehicles', entity: 'none' },
    webPath: null,
    phase: 'P5',
  },
  'report.export_ready': {
    key: 'report.export_ready',
    audience: 'staff',
    params: [],
    push: false,
    target: { route: '/inbox', entity: 'none' },
    webPath: '/exports',
    phase: 'P6',
  },
}

/** Constants of DOC-31 §9: the cap the bell shows, the push chunk and the notice-title cut. */
export const INBOX_UNREAD_CAP = 100
export const PUSH_CHUNK_SIZE_MAX = 100
export const NOTICE_TITLE_PUSH_MAX = 100
