import type { InboxPlan, InboxRule, NotificationIntegration } from '@mod/notification/integration'
import {
  type BatchDueExtendedPayload,
  type BatchPublishedPayload,
  type BatchRecalledPayload,
  type ChargeVoidedPayload,
  type DebtReminderSentPayload,
  FINANCE_EVENTS,
  type MoneyUnpostedPayload,
  type PaymentPostedPayload,
  type PaymentVoidedPayload,
} from '../../contracts'

/** The members who see a unit's fees: owner, family, tenant; not helpers (DOC-31 §3.2, DR-20). */
const members = (unitId: string) => ({
  kind: 'unit_members' as const,
  unitId,
  capability: 'view_fees' as const,
})

const rule = <P>(event: string, handler: string, plan: InboxRule<P>['plan']): InboxRule<P> => ({
  event,
  handler,
  plan,
})

/**
 * What the events of `finance` mean in the inbox (DOC-31 §3.2, DOC-12 §4.4): the template, the recipients, the object the entry
 * is about and the push-safe params. Pure; `notification` resolves the recipients and writes the rows (DOC-31 §4.1). A batch
 * message carries at most 500 units (DOC-09 §3.4), one plan each.
 */
export const financeNotifications: NotificationIntegration = {
  producer: 'finance',
  rules: [
    rule<BatchPublishedPayload>(
      FINANCE_EVENTS.batchPublished,
      'notification.inbox_on_finance_batch_published',
      (p) =>
        p.unitIds.map(
          (unitId): InboxPlan => ({
            templateKey: 'fee.batch_published',
            recipients: members(unitId),
            source: { kind: 'batch', id: p.batchId },
            dedupe: 'source',
            params: { batchCode: p.code, feeMonth: p.feeMonth },
          }),
        ),
    ),
    rule<BatchRecalledPayload>(
      FINANCE_EVENTS.batchRecalled,
      'notification.inbox_on_finance_batch_recalled',
      (p) =>
        p.unitIds.map(
          (unitId): InboxPlan => ({
            templateKey: 'fee.batch_recalled',
            recipients: members(unitId),
            source: { kind: 'batch', id: p.batchId },
            dedupe: 'source',
            params: { batchCode: p.code, feeMonth: p.feeMonth },
          }),
        ),
    ),
    rule<BatchDueExtendedPayload>(
      FINANCE_EVENTS.batchDueExtended,
      'notification.inbox_on_finance_batch_due_extended',
      (p) =>
        p.unitIds.map(
          (unitId): InboxPlan => ({
            templateKey: 'fee.batch_due_extended',
            recipients: members(unitId),
            source: { kind: 'batch', id: p.batchId },
            dedupe: 'event',
            params: { batchCode: p.code, dueDate: p.dueDate },
          }),
        ),
    ),
    rule<ChargeVoidedPayload>(
      FINANCE_EVENTS.chargeVoided,
      'notification.inbox_on_finance_charge_voided',
      (p) => [
        {
          templateKey: 'fee.charge_voided',
          recipients: members(p.unitId),
          source: { kind: 'charge', id: p.chargeId },
          dedupe: 'source',
          params: { feeMonth: p.feeMonth },
        },
      ],
    ),
    rule<DebtReminderSentPayload>(
      FINANCE_EVENTS.debtReminderSent,
      'notification.inbox_on_finance_debt_reminder_sent',
      (p) =>
        p.reminders.map(
          (reminder): InboxPlan => ({
            templateKey: 'fee.reminder',
            recipients: members(reminder.unitId),
            source: { kind: 'debt_reminder', id: reminder.reminderId },
            dedupe: 'source',
            params: {},
          }),
        ),
    ),
    rule<PaymentPostedPayload>(
      FINANCE_EVENTS.paymentPosted,
      'notification.inbox_on_finance_payment_posted',
      (p) => [
        {
          templateKey: 'payment.received',
          recipients: members(p.unitId),
          source: { kind: 'payment', id: p.paymentId },
          dedupe: 'source',
          params: {},
        },
      ],
    ),
    rule<PaymentVoidedPayload>(
      FINANCE_EVENTS.paymentVoided,
      'notification.inbox_on_finance_payment_voided',
      (p) => [
        {
          templateKey: 'payment.voided',
          recipients: members(p.unitId),
          source: { kind: 'payment', id: p.paymentId },
          dedupe: 'source',
          params: {},
        },
      ],
    ),
    rule<MoneyUnpostedPayload>(
      FINANCE_EVENTS.moneyUnposted,
      'notification.inbox_on_finance_money_unposted',
      (p) => [
        {
          templateKey: 'finance.money_unposted',
          recipients: { kind: 'staff_roles', roles: ['manager', 'admin'] },
          source: { kind: p.kind, id: p.rowId },
          dedupe: 'source',
          params: {},
        },
      ],
    ),
  ],
}
