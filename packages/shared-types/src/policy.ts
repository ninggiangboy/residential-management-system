import type { UnitContext } from './contexts'
import type { Capability } from './people'

/**
 * The table of original SDD §7.4, as data and written once (DOC-27 §3.2, DOC-12 §11.2). `can_pay` matters only for a tenant.
 * The server decides with it on every request; the apps read the same table to hide or disable a control (DOC-55 §7.1).
 */
/** What the table reads of a membership: the apps hold no more than this. */
export type PolicySubject = Pick<UnitContext, 'memberType' | 'canPay'>

const RULES: Record<Capability, (c: PolicySubject) => boolean> = {
  broadcast_notices: () => true,
  personal_notifications: (c) => c.memberType !== 'helper',
  view_fees: (c) => c.memberType !== 'helper',
  pay: (c) =>
    c.memberType === 'owner' ||
    c.memberType === 'family' ||
    (c.memberType === 'tenant' && c.canPay),
  tickets: (c) => c.memberType !== 'helper',
  vehicles: (c) => c.memberType !== 'helper',
  library: (c) => c.memberType !== 'helper',
  manage_members: (c) => c.memberType === 'owner',
}

export const can = (context: PolicySubject, capability: Capability): boolean =>
  RULES[capability](context)
