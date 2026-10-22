import type { StaffRole } from '@rms/shared-types'

/** The claims of an access token (DOC-26 §3.1). `role` is informational: the staff guard reads the row on every request. */
export type AccessClaims =
  | { sub: string; kind: 'staff'; role: StaffRole; bid: string; sid: string }
  | { sub: string; kind: 'resident'; sid: string }

/**
 * Verifies an access token: only `alg = ES256`, a known `kid`, `iss = "rms"`, `exp` with 5 seconds of tolerance. Every failure
 * is a 401 `unauthenticated` (DOC-26 §3.1). The guards of `apps/api` are built on it (DOC-12 §5.3).
 */
export interface AccessTokenVerifier {
  verify(token: string): Promise<AccessClaims>
}
