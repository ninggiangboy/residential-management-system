/** The OTP and reset-link resend are enabled this long after each send (DR-208, DOC-55 §5.3). A convenience: the server buckets are the limit. */
export const RESEND_AFTER_SECONDS = 45

/** The access token is refreshed before a call when it expires within this many milliseconds (DOC-55 §5.2 rule 1). */
export const REFRESH_AHEAD_MS = 30_000

/** The header names of DOC-55 §4.2, spelled once. */
export const HEADERS = {
  authorization: 'Authorization',
  unitId: 'X-Unit-Id',
  language: 'Accept-Language',
  appId: 'X-App-Id',
  appVersion: 'X-App-Version',
  requestId: 'X-Request-Id',
  idempotencyKey: 'Idempotency-Key',
  ifMatch: 'If-Match',
  requestedWith: 'X-Requested-With',
} as const
