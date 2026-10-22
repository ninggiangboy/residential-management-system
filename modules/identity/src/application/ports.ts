import type { AccessClaims } from '../contracts'

/** Argon2id (DOC-26 §4.2). The adapter is `Bun.password`; the application never sees the algorithm's parameters. */
export interface PasswordHasher {
  hash(plain: string): Promise<string>
  verify(plain: string, hash: string): Promise<boolean>
  /** Compares `m` and `t` of the stored string with the configuration. */
  needsRehash(hash: string): boolean
  /** One verify against a fixed hash of the configured parameters, so an unknown email takes as long as a real check. */
  dummyVerify(plain: string): Promise<void>
}

/** ES256 with the key ring `JWT_KEYS`, signing with the newest `kid` (DOC-26 §3.1, §3.2). */
export interface TokenSigner {
  signAccess(claims: AccessClaims): Promise<{ token: string; expiresIn: number }>
}

/** The random values and digests of DOC-26: opaque tokens, six-digit codes, and the HMAC that binds a code. */
export interface TokenFactory {
  /** 256 random bits, base64url, with the SHA-256 that is stored (DOC-16 §4.5). */
  opaque(): { token: string; hash: string }
  hashOpaque(token: string): string
  /** `digits` uniform decimal digits, zero-padded. */
  digits(digits: number): string
  /** `HMAC-SHA256(OTP_HMAC_KEY, "stepup:" || staff || ":" || action || ":" || code)` in hex (DR-132). */
  stepUpHmac(staffId: string, action: string, code: string): string
}

/** `@core/mail`'s `Mailer`: console, allowlist or smtp by `MAIL_DRIVER` (DOC-26 §5.5). */
export interface Mailer {
  send(mail: { to: string; subject: string; text: string; html: string }): Promise<void>
}

/** Runs `fn` in its own transaction, committed before it returns (DR-132). Only the step-up failure counter uses it. */
export interface AutonomousTransaction {
  run<T>(fn: () => Promise<T>): Promise<T>
}

/** A wall-clock wait, so the floor of the reset answer time costs nothing in a test. */
export type Delay = (milliseconds: number) => Promise<void>

/** One token-bucket rule: a limit of N per period is a capacity of N refilled at N / period (DOC-26 §6). */
export interface RateRule {
  key: string
  capacity: number
  perSeconds: number
}

/**
 * The buckets of DOC-26 §6. `take` spends one token and throws `RateLimitedError` (429) with `Retry-After` when the bucket is
 * empty. It joins the caller's transaction when there is one; a sign-in or a reset takes its tokens outside, so a refusal
 * is never rolled back with the request.
 */
export interface RateLimiter {
  take(rule: RateRule): Promise<void>
}
