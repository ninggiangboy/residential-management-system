import type { NotificationIntegration } from '@mod/notification/integration'
import {
  type MembershipChangedPayload,
  type OwnerChangedPayload,
  RESIDENCY_EVENTS,
} from '../../contracts'

/**
 * `member.added` (DOC-31 §3.2): the account that was added to a unit, and the new owner of a transfer. Every other membership
 * change tells the inbox nothing (DOC-27 §2.3). A transfer can happen twice for one unit, so the owner entry dedupes by event.
 */
export const residencyNotifications: NotificationIntegration = {
  producer: 'residency',
  rules: [
    {
      event: RESIDENCY_EVENTS.membershipChanged,
      handler: 'notification.inbox_on_residency_membership_changed',
      plan: (p: MembershipChangedPayload) =>
        p.change !== 'added'
          ? []
          : [
              {
                templateKey: 'member.added',
                recipients: { kind: 'resident', accountId: p.accountId, unitId: p.unitId },
                source: { kind: 'membership', id: p.membershipId },
                dedupe: 'source',
                params: {},
              },
            ],
    },
    {
      event: RESIDENCY_EVENTS.ownerChanged,
      handler: 'notification.inbox_on_residency_owner_changed',
      plan: (p: OwnerChangedPayload) => [
        {
          templateKey: 'member.added',
          recipients: { kind: 'resident', accountId: p.newOwnerAccountId, unitId: p.unitId },
          source: { kind: 'unit', id: p.unitId },
          dedupe: 'event',
          params: {},
        },
      ],
    },
  ],
}
