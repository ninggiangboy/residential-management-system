import type { BuildingId, StaffContext } from '@rms/shared-types'

/** What a secret or a personal value is recorded as: the row says the field changed, never the value (DOC-35 §3.4). */
export const MASKED = '[masked]'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

/** Already masked where the field is personal or secret. */
export type AuditValue = string | number | boolean | null

/** `field` is a dotted path, e.g. `receivingAccount.accountNumber`. */
export interface AuditChange {
  field: string
  before: AuditValue
  after: AuditValue
}

/** `<module>.<object>.<verb>`, or the two-part `pii.read` (DOC-17 §2). */
export type AuditAction = string

/** The system changes a fact no staff member asked for. The list of actions that may use it is closed (DOC-35 §3.6). */
export interface SystemActor {
  readonly kind: 'system'
  readonly source: 'webhook' | 'requery' | 'statement' | 'job'
  readonly buildingId: BuildingId
}
export type AuditActor = StaffContext | SystemActor

export interface AuditEntry {
  actor: AuditActor
  action: AuditAction
  /** An action on a set names its parent object. */
  object: { type: string; id: string }
  /** `[]` when the action changes no field (a state change with a reason, a bulk form). */
  changes: AuditChange[]
  /** Required by the actions of DOC-35 §3.5: 5 to 500 characters after trimming. */
  reason?: string
  /** Facts that are not field changes: `{ recordCount: 300 }`. */
  details?: Record<string, JsonValue>
}

/**
 * Behaves like `OutboxWriter.add` (DOC-12 §8.1): it joins the caller's transaction and throws when none is open, because a
 * row written outside the mutation's transaction would defeat the purpose (ADR-0018). Actor, role, IP, user agent and
 * request id are filled from the actor and the request context, not by the caller.
 */
export interface AuditApi {
  record(entry: AuditEntry): Promise<void>
}

/** How a field of an audited object is masked before it reaches `record` (DOC-35 §3.4). */
export type MaskKind = 'secret' | 'personal' | 'phone' | 'email'

export interface AuditedSpec<A extends unknown[], R> {
  action: AuditAction
  object: (result: NoInfer<R>) => { type: string; id: string }
  /** Where the reason is in the arguments; required for the actions of DOC-35 §3.5. */
  reason?: (...args: A) => string | undefined
  /** Per field of the object type: the mask the wrapper applies. A field of the global deny-list that is not here is refused by `record`. */
  masks?: Readonly<Record<string, MaskKind>>
  details?: (result: NoInfer<R>) => Record<string, JsonValue> | undefined
}

/**
 * The wrapper every audited use case goes through (DOC-35 §3.2, DOC-12 §8.3): refuses a missing or short reason before the
 * body runs, runs the body in the caller's transaction, masks the changes it returns and records them. It never opens a
 * transaction. The first argument is the actor (`StaffContext` or `SystemActor`).
 */
export type Audited = <A extends [actor: AuditActor, ...rest: unknown[]], R>(
  spec: AuditedSpec<A, R>,
  body: (...args: A) => Promise<{ result: R; changes: AuditChange[] }>,
) => (...args: A) => Promise<R>
