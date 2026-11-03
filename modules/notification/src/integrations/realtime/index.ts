import type { RealtimeMapping } from '@mod/realtime/contracts'
import { NOTIFICATION_EVENTS, type StaffInboxCreatedPayload } from '../../contracts'

/** `inbox.created` (DOC-52 §6.1): every staff entry tells that member's open tabs to refetch the bell. */
export const notificationRealtime: RealtimeMapping<StaffInboxCreatedPayload>[] = [
  {
    handler: 'realtime.sse_on_notification_staff_inbox_created',
    eventType: NOTIFICATION_EVENTS.staffInboxCreated,
    build: (p) => ({
      buildingId: p.buildingId,
      target: { accountId: p.staffId },
      event: { type: 'inbox.created', data: { entryId: p.entryId, templateKey: p.templateKey } },
    }),
  },
]
