import { ForbiddenError, RuleViolationError } from '@core/kernel'
import type { BuildingScope } from '@rms/shared-types'
import type { OpenTicketsProbe, StepUpAction } from '../contracts'
import { LastAdminError, StaffHasOpenTicketsError } from '../domain/errors'
import type { StaffAccount, StaffActor } from '../domain/staff-account'
import type { StaffAccountRepository } from '../domain/staff-account-repository'

/** `{ password, code }` of E-38: the proof a sensitive request carries. */
export interface StepUpProof {
  password: string
  code: string
}

const MIN_REASON = 5
const MAX_REASON = 500

/** A reason that goes with `reassignTo` (DR-147): 5 to 500 characters once trimmed. */
export function checkedReassignReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? ''
  if (trimmed.length < MIN_REASON || trimmed.length > MAX_REASON)
    throw new RuleViolationError(
      'reason_too_short',
      `A reason of ${MIN_REASON} to ${MAX_REASON} characters is required`,
      'reason',
    )
  return trimmed
}

/** The proof a sensitive request must carry, decided before any database work (FR-50.2, DR-147). */
export function requireProof(
  proof: StepUpProof | undefined,
  action: StepUpAction,
): asserts proof is StepUpProof {
  if (!proof)
    throw new ForbiddenError('step_up_required', 'A step-up proof is required', {
      details: { action },
    })
}

/**
 * The two rules that guard a lock, a disable and a role change beyond who may do it (DOC-26 §4.4 rules 3 and 4): the building keeps
 * an active Admin, and nobody leaves open tickets behind unless an Admin moves them. Both run in the transaction of the change.
 */
export class StaffSafeguards {
  constructor(
    private readonly staffAccounts: StaffAccountRepository,
    private readonly tickets: OpenTicketsProbe,
  ) {}

  /**
   * Locks the active Admin rows first, so two Admins that act on each other at the same moment take turns, then counts the
   * others. Only the change of an active Admin can leave the building without one (AU-17, AU-S08).
   */
  async keepsAnAdmin(scope: BuildingScope, target: StaffAccount): Promise<void> {
    if (!target.isActiveAdmin) return
    const admins = await this.staffAccounts.lockActiveAdminIds(scope)
    if (!admins.some((id) => id !== target.id)) throw new LastAdminError()
  }

  /**
   * A person with open tickets is refused (409, the tickets listed) unless an Admin names an active Technician or Guard to take
   * them, with a reason; then they move in this transaction. Returns who took them, or `null` when there was nothing to move.
   */
  async clearTickets(
    scope: BuildingScope,
    actor: StaffActor,
    target: StaffAccount,
    reassign: { to: string; reason: string } | undefined,
  ): Promise<string | null> {
    const open = await this.tickets.openTicketsOf(target.id)
    if (open.length === 0) return null
    if (!reassign || actor.role !== 'admin') throw new StaffHasOpenTicketsError(open)
    const assignee = await this.staffAccounts.findScoped(scope, reassign.to)
    if (
      !assignee ||
      assignee.id === target.id ||
      assignee.status !== 'active' ||
      (assignee.role !== 'technician' && assignee.role !== 'guard')
    )
      throw new RuleViolationError(
        'assignee_locked',
        'The person who takes the tickets must be an active Technician or Guard',
        'reassignTo',
      )
    await this.tickets.reassignAll(target.id, assignee.id)
    return assignee.id
  }
}
