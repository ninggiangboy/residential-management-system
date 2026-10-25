/**
 * What `identity` reads from the configuration (DOC-26 §9, keys in DOC-41 §8). The values reach the module as plain numbers and
 * strings; `apps/api` reads them from the environment.
 */
export interface IdentityConfig {
  /** `ACCESS_TOKEN_TTL_SECONDS` (900). */
  accessTtlSeconds: number
  /** `REFRESH_TTL_DAYS_STAFF` (30): the sliding lifetime of a staff refresh token. */
  refreshTtlDaysStaff: number
  /** `FAMILY_MAX_DAYS_STAFF` (90): the absolute lifetime of a staff family. */
  familyMaxDaysStaff: number
  /** `REFRESH_TTL_DAYS_RESIDENT` (180): the sliding lifetime of a resident refresh token. */
  refreshTtlDaysResident: number
  /** `FAMILY_MAX_DAYS_RESIDENT` (365): the absolute lifetime of a resident family. */
  familyMaxDaysResident: number
  /** `MAX_FAMILIES_PER_ACCOUNT` (10). */
  maxFamilies: number
  /** `REFRESH_GRACE_SECONDS` (10). */
  refreshGraceSeconds: number
  /** `INVITE_TTL_HOURS` (24). */
  inviteTtlHours: number
  /** `RESET_TTL_MINUTES` (30). */
  resetTtlMinutes: number
  /** `STEPUP_TTL_MINUTES` (10). */
  stepUpTtlMinutes: number
  /** `STEPUP_MAX_ATTEMPTS` (5). */
  stepUpMaxAttempts: number
  /** `STEPUP_REQUESTS_PER_HOUR` (5). */
  stepUpRequestsPerHour: number
  /** `STAFF_LOGIN_PER_IP` (30 per 15 minutes). */
  staffLoginPerIp: number
  /** `RESET_PER_EMAIL_PER_HOUR` (3). */
  resetPerEmailPerHour: number
  /** `RESET_PER_IP_PER_HOUR` (10). */
  resetPerIpPerHour: number
  /** `RESET_MIN_RESPONSE_MS` (150). */
  resetMinResponseMs: number
  /** `OTP_TTL_SECONDS` (300). */
  otpTtlSeconds: number
  /** `OTP_RESEND_AFTER_SECONDS` (45). */
  otpResendAfterSeconds: number
  /** `OTP_MAX_ATTEMPTS` (5). */
  otpMaxAttempts: number
  /** `OTP_PER_PHONE_PER_HOUR` (5). */
  otpPerPhonePerHour: number
  /** `OTP_PER_IP_PER_HOUR` (20). */
  otpPerIpPerHour: number
  /** `OTP_DAILY_CAP` (3000): challenges in a rolling 24 hours for the whole deployment. */
  otpDailyCap: number
  /** `CLIENT_ERRORS_PER_MINUTE_PER_IP` (10). */
  clientErrorsPerMinutePerIp: number
  /** `CLIENT_ERRORS_PER_HOUR_PER_ACCOUNT` (30). */
  clientErrorsPerHourPerAccount: number
  /** `SMS_DOWN_FAILURES` (3): failing commands, with none delivered in 10 minutes, that mark the provider down. */
  smsDownFailures: number
  /** `SMS_BRAND`: the registered sender text, in every message. */
  smsBrand: string
  /** `APP_DOWNLOAD_URL`: the link of the invitation SMS. */
  appDownloadUrl: string
  /** `ADMIN_BASE_URL`: the base of the invite and reset links. */
  adminBaseUrl: string
}
