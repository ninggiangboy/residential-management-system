import type { Capability, Params, SourceKind, StaffRole, TemplateKey } from '@rms/shared-types'

/**
 * What a producer ships so `notification` can turn its events into inbox entries (DOC-31 §2.2). A type-only contract: a
 * producer's `integrations/notification.ts` exports one `NotificationIntegration` and never imports this module (§4.4).
 */

/** How one plan resolves into recipients (DOC-31 §2.2, §2.3). */
export type Recipients =
  | { kind: 'unit_members'; unitId: string; capability: Capability }
  | { kind: 'staff_roles'; roles: StaffRole[] }
  | { kind: 'resident'; accountId: string; unitId: string | null }
  | { kind: 'staff'; staffId: string }
  | { kind: 'accounts'; accounts: Array<{ accountKind: 'resident' | 'staff'; accountId: string }> }

/** One thing to tell, once its recipients are resolved (DOC-31 §2.2, §4.1 step 2). */
export interface InboxPlan {
  templateKey: TemplateKey
  recipients: Recipients
  source: { kind: SourceKind; id: string }
  dedupe: 'source' | 'event'
  params: Params
  urgent?: boolean
}

/** One event a producer maps to plans (DOC-31 §2.2): `plan` is pure, and `[]` means nothing to tell. */
export interface InboxRule<P = unknown> {
  readonly event: string
  readonly handler: string
  plan(payload: P, meta: { eventId: string; buildingId: string }): InboxPlan[]
}

/** What a producer's `integrations/notification.ts` exports (DOC-31 §2.2). */
export interface NotificationIntegration {
  readonly producer: string
  readonly rules: readonly InboxRule[]
}
