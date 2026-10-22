/**
 * The staff mails of `identity` (DOC-26 §5.4): the invite, the password reset, the step-up code and the step-up notice. A mail
 * holds only a link or a code and generic text (DR-58, DR-68). The key set is part of `en` of `catalog.ts`.
 */
export const mailEn = {
  'mail.staff_invite.subject': 'Set your password',
  'mail.staff_invite.body':
    'Hello {name},\n\nAn account was created for you. Open this link to set your password. The link works once and expires in {hours} hours:\n\n{link}\n\nIf you did not expect this message, you can ignore it.',
  'mail.password_reset.subject': 'Reset your password',
  'mail.password_reset.body':
    'Hello {name},\n\nOpen this link to choose a new password. The link works once and expires in {minutes} minutes:\n\n{link}\n\nIf you did not ask for this, you can ignore it. Your password stays the same.',
  'mail.step_up_code.subject': 'Your confirmation code',
  'mail.step_up_code.body':
    'Hello {name},\n\nYour confirmation code for "{action}" is {code}. It works once and expires in {minutes} minutes. Do not share it with anyone.',
  'mail.step_up_notice.subject': 'A sensitive change was made',
  'mail.step_up_notice.body':
    'Hello {name},\n\n{actorName} confirmed a sensitive change: {action}. If this was not expected, contact your administrator.',
  'mail.action.gateway_config': 'payment gateway settings',
  'mail.action.admin_change': 'administrator account',
  'mail.action.staff_email': 'staff email address',
} as const
