/**
 * The SMS texts of `identity` (DOC-26 §5.4): the login code and the member invitation. At most 160 characters once the
 * parameters are filled in, because the registered brandname sends one message part (DR-37). The key set is part of `en` of
 * `catalog.ts`.
 */
export const smsEn = {
  'sms.otp': '{code} is your {brand} login code. Valid for 5 minutes. Do not share it.',
  'sms.member_invitation':
    'You are invited to unit {unitCode} on the {brand} app. Get the app and sign in with this number: {appUrl}',
} as const
