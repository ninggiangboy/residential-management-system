import type { Capability, UnitContext } from '@rms/shared-types'

export type { UnitContext }

/** The table of original SDD §7.4, as data and written once (DOC-27 §3.2). `can_pay` matters only for a tenant. */
const RULES: Record<Capability, (c: UnitContext) => boolean> = {
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

export const can = (context: UnitContext, capability: Capability): boolean =>
  RULES[capability](context)
