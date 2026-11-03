import type { NotificationIntegration } from '@mod/notification/integration'
import { IDENTITY_EVENTS, type MailRequestedPayload } from '../../contracts'

const ACTIONS = new Set(['gateway_config', 'admin_change', 'staff_email'])

/**
 * The step-up notice (FR-50.4, DOC-31 §3.2): `identity.mail_requested.v1` of kind `step_up_notice` is one message per Admin, and
 * each also becomes an inbox entry `staff.step_up_done` for that Admin. Any other mail kind tells the inbox nothing. The name in
 * `actorName` is a staff member's, in an entry that never pushes (DOC-31 §3.2 notes).
 */
export const identityNotifications: NotificationIntegration = {
  producer: 'identity',
  rules: [
    {
      event: IDENTITY_EVENTS.mailRequested,
      handler: 'notification.inbox_on_identity_mail_requested',
      plan: (payload: MailRequestedPayload, meta) => {
        if (payload.kind !== 'step_up_notice') return []
        const action = payload.params.action ?? ''
        return [
          {
            templateKey: 'staff.step_up_done',
            recipients: { kind: 'staff', staffId: payload.staffId },
            source: { kind: 'step_up', id: meta.eventId },
            dedupe: 'event',
            params: {
              action: ACTIONS.has(action) ? action : 'other',
              actorName: payload.params.actorName ?? '',
            },
          },
        ]
      },
    },
  ],
}
