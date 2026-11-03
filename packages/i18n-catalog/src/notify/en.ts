/**
 * The inbox and push texts of DOC-31 §3.4 (the `notify.*` family, DR-303): `notify.<templateKey>.title` and `.body`. The key
 * set is part of `en` of `catalog.ts`; the same 42 keys exist in `vi` (parity test UICP-01).
 */
export const notifyEn = {
  'notify.fee.batch_published.title': '{feeMonth} fees published',
  'notify.fee.batch_published.body':
    'Fee batch {batchCode} is ready. Open the app to see the details.',
  'notify.fee.batch_recalled.title': 'Fee batch {batchCode} withdrawn',
  'notify.fee.batch_recalled.body':
    'The management office withdrew this batch. Its charges no longer need to be paid.',
  'notify.fee.batch_due_extended.title': 'Fee batch {batchCode} extended',
  'notify.fee.batch_due_extended.body': 'The new due date is {dueDate}.',
  'notify.fee.charge_voided.title': 'A charge for {feeMonth} was cancelled',
  'notify.fee.charge_voided.body':
    'The management office cancelled a charge. A corrected one, if any, will be issued again.',
  'notify.fee.reminder.title': 'Fee reminder',
  'notify.fee.reminder.body': 'Your unit has unpaid fees. Open the app to see them.',
  'notify.payment.received.title': 'Payment received',
  'notify.payment.received.body': 'A payment was recorded. The receipt is in the app.',
  'notify.payment.voided.title': 'A payment was voided',
  'notify.payment.voided.body':
    'The management office voided a recorded payment. Open the app to see it.',
  'notify.finance.money_unposted.title': 'Money to check',
  'notify.finance.money_unposted.body': 'An incoming transfer was not posted. See the money log.',
  'notify.staff.step_up_done.title': 'Sensitive change confirmed',
  'notify.staff.step_up_done.body':
    '{actorName} {action, select, gateway_config {changed the payment gateway settings} admin_change {created or promoted an Admin} staff_email {changed a staff email} other {made a sensitive change}}.',
  'notify.member.added.title': 'You were added to a unit',
  'notify.member.added.body': 'Open the app to see the unit.',
  'notify.ticket.new_unassigned.title': 'New ticket {ticketCode}',
  'notify.ticket.new_unassigned.body': 'A new ticket is waiting to be assigned.',
  'notify.ticket.assigned.title': 'Ticket {ticketCode} assigned to you',
  'notify.ticket.assigned.body': 'Open the app to accept or reject it.',
  'notify.ticket.status_changed.title': 'Request {ticketCode} updated',
  'notify.ticket.status_changed.body': 'New status: {status}.',
  'notify.ticket.commented.title': 'New reply on request {ticketCode}',
  'notify.ticket.commented.body': 'Open the app to read it.',
  'notify.ticket.rejected.title': 'Ticket {ticketCode} rejected',
  'notify.ticket.rejected.body': 'The technician rejected the ticket. Assign it again.',
  'notify.ticket.awaiting_close.title': 'Ticket {ticketCode} awaits closing',
  'notify.ticket.awaiting_close.body': 'The work is done. Check it and close the ticket.',
  'notify.notice.published.title': 'New notice: {noticeTitle}',
  'notify.notice.published.body': 'Open the app to read it.',
  'notify.vehicle.pending_review.title': 'Vehicle awaiting review',
  'notify.vehicle.pending_review.body': 'A vehicle registration is waiting for review.',
  'notify.vehicle.approved.title': 'Vehicle approved',
  'notify.vehicle.approved.body': "Your unit's vehicle registration was approved.",
  'notify.vehicle.rejected.title': 'Vehicle not approved',
  'notify.vehicle.rejected.body': 'Open the app to see why and fix the registration.',
  'notify.report.export_ready.title': 'Your export is ready',
  'notify.report.export_ready.body': 'The file is in the export center for 7 days.',
} as const
