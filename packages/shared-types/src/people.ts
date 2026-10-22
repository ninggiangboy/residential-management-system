/** Staff roles (DOC-16 `staff_account.role`, original SDD §7.4). */
export const STAFF_ROLES = ['admin', 'manager', 'technician', 'guard'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

/** Member types of a unit membership (DOC-16 `membership.member_type`). */
export const MEMBER_TYPES = ['owner', 'family', 'tenant', 'helper'] as const
export type MemberType = (typeof MEMBER_TYPES)[number]

/** What a member of a unit may do; the table that grants them is `@mod/residency`'s `can` (DOC-12 §11.2, DOC-27). */
export const CAPABILITIES = [
  'broadcast_notices',
  'personal_notifications',
  'view_fees',
  'pay',
  'tickets',
  'vehicles',
  'library',
  'manage_members',
] as const
export type Capability = (typeof CAPABILITIES)[number]

/** Notice categories (DR-50). */
export const NOTICE_CATEGORIES = ['general', 'maintenance', 'urgent', 'event'] as const
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number]
