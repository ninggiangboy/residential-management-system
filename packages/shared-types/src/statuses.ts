/**
 * The status columns of the data documents, one tuple per column (DOC-14 §9: the schema builds its `CHECK` from the
 * same constant). Status presentation (`status.json` of `@rms/design-tokens`, DS-04) walks `STATUS_ENUMS`, so a value
 * added here without a row there fails the build. Finance (DOC-15, DOC-23), tickets, vehicles and notices are not
 * written yet: their values are those of DOC-54 §6 and DOC-14 §15, checked again when their documents are.
 */
export const FEE_BATCH_STATUSES = ['draft', 'published', 'recalled', 'closed'] as const
export const CHARGE_STATUSES = ['draft', 'open', 'paid', 'void'] as const
export const PAYMENT_INTENT_STATUSES = [
  'creating',
  'pending',
  'paid',
  'failed',
  'expired',
  'cancelling',
  'cancelled',
] as const
export const TICKET_STATUSES = [
  'submitted',
  'assigned',
  'accepted',
  'in_progress',
  'on_hold',
  'resolved',
  'closed',
  'cancelled',
] as const
export const VEHICLE_STATUSES = ['pending', 'approved', 'rejected', 'retired'] as const
export const MEMBERSHIP_STATUSES = ['active', 'locked', 'removed'] as const
export const RESIDENT_ACCOUNT_STATUSES = ['active', 'deletion_requested', 'deleted'] as const
export const STAFF_ACCOUNT_STATUSES = ['invited', 'active', 'locked', 'disabled'] as const
export const NOTICE_STATUSES = ['draft', 'scheduled', 'sending', 'sent'] as const
export const UNIT_OCCUPANCIES = ['occupied', 'rented', 'vacant'] as const
export const IMPORT_JOB_STATUSES = ['validated', 'failed', 'committed', 'expired'] as const
export const UNIT_TYPE_STATUSES = ['active', 'archived'] as const

export type FeeBatchStatus = (typeof FEE_BATCH_STATUSES)[number]
export type ChargeStatus = (typeof CHARGE_STATUSES)[number]
export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number]
export type TicketStatus = (typeof TICKET_STATUSES)[number]
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number]
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number]
export type ResidentAccountStatus = (typeof RESIDENT_ACCOUNT_STATUSES)[number]
export type StaffAccountStatus = (typeof STAFF_ACCOUNT_STATUSES)[number]
export type NoticeStatus = (typeof NOTICE_STATUSES)[number]
export type UnitOccupancy = (typeof UNIT_OCCUPANCIES)[number]
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number]
export type UnitTypeStatus = (typeof UNIT_TYPE_STATUSES)[number]

/** Every enumeration DS-04 checks, by the entity name `status.json` uses (DOC-54 §14). */
export const STATUS_ENUMS = {
  fee_batch: FEE_BATCH_STATUSES,
  charge: CHARGE_STATUSES,
  payment_intent: PAYMENT_INTENT_STATUSES,
  ticket: TICKET_STATUSES,
  vehicle: VEHICLE_STATUSES,
  membership: MEMBERSHIP_STATUSES,
  resident_account: RESIDENT_ACCOUNT_STATUSES,
  staff_account: STAFF_ACCOUNT_STATUSES,
  notice: NOTICE_STATUSES,
  unit: UNIT_OCCUPANCIES,
  import_job: IMPORT_JOB_STATUSES,
  unit_type: UNIT_TYPE_STATUSES,
} as const
export type StatusEntity = keyof typeof STATUS_ENUMS
