/**
 * The retry classes of DOC-09 §4.2: a class is the number of attempts a message gets. A type belongs to one class, named in
 * the `outboxPolicies` of its module's manifest; a type that is not named is `default`.
 */
export const RETRY_CLASSES = ['default', 'sms', 'push', 'intent_cancel'] as const
export type RetryClass = (typeof RETRY_CLASSES)[number]

/** What the relay needs to know about one message type. */
export interface OutboxPolicy {
  /** The attempt that dead-letters the message (attempts are counted at claim time). */
  maxAttempts: number
}

/** The relay's settings (DOC-38 §2.6). The application builds them from the configuration slice of DOC-41 §11. */
export interface OutboxSettings {
  pollIntervalMs: number
  batchSize: number
  concurrency: number
  leaseSeconds: number
  backoffBaseSeconds: number
  backoffMaxSeconds: number
  deferBudgetHours: number
  retentionDays: number
  cleanupIntervalMinutes: number
}
