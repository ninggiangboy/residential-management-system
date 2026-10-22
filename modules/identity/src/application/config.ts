/**
 * What the staff side of `identity` reads from the configuration (DOC-26 §9, keys in DOC-41 §8). The resident keys join with
 * P1-11. The values reach the module as plain numbers; `apps/api` reads them from the environment.
 */
export interface IdentityConfig {
  /** `ACCESS_TOKEN_TTL_SECONDS` (900). */
  accessTtlSeconds: number
  /** `REFRESH_TTL_DAYS_STAFF` (30): the sliding lifetime of a staff refresh token. */
  refreshTtlDaysStaff: number
  /** `FAMILY_MAX_DAYS_STAFF` (90): the absolute lifetime of a staff family. */
  familyMaxDaysStaff: number
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
  /** `ADMIN_BASE_URL`: the base of the invite and reset links. */
  adminBaseUrl: string
}
