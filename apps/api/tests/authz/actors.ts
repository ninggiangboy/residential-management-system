import type { STAFF_ROLES } from '@rms/shared-types'

/**
 * The sixteen actors of DOC-39 §4.2. A token actor holds a real token issued by the sign-in use case. `ACTORS` is complete by
 * test: a role added to `@rms/shared-types` without an actor here fails `actors.authz.test.ts` (EXP-10 §10).
 */
export const ACTORS = [
  'anon',
  'tok.expired',
  'res.owner',
  'res.family',
  'res.tenant_pay',
  'res.tenant_nopay',
  'res.helper',
  'res.locked',
  'res.terms_pending',
  'res.stranger',
  'staff.admin',
  'staff.manager',
  'staff.technician',
  'staff.guard',
  'staff.disabled',
  'staff.admin_b2',
] as const
export type Actor = (typeof ACTORS)[number]

export const isResident = (actor: Actor) => actor.startsWith('res.')
export const isStaff = (actor: Actor) => actor.startsWith('staff.')

/** The member type and `can_pay` of the residents that are active members of U1 (the rows of DOC-27 §3.2). */
export const MEMBER_OF_U1: Partial<
  Record<Actor, { memberType: 'owner' | 'family' | 'tenant' | 'helper'; canPay: boolean }>
> = {
  'res.owner': { memberType: 'owner', canPay: false },
  'res.family': { memberType: 'family', canPay: false },
  'res.tenant_pay': { memberType: 'tenant', canPay: true },
  'res.tenant_nopay': { memberType: 'tenant', canPay: false },
  'res.helper': { memberType: 'helper', canPay: false },
  // One owner per unit (`membership_one_owner_per_account_unit`): the member who has not accepted the terms is a family member.
  'res.terms_pending': { memberType: 'family', canPay: false },
}

/** The role of a staff actor; `staff.disabled` is a Manager whose account was disabled after the token was issued. */
export const STAFF_ROLE_OF: Partial<Record<Actor, (typeof STAFF_ROLES)[number]>> = {
  'staff.admin': 'admin',
  'staff.manager': 'manager',
  'staff.technician': 'technician',
  'staff.guard': 'guard',
  'staff.disabled': 'manager',
  'staff.admin_b2': 'admin',
}
