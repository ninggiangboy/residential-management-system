import { type Clock, type IdGenerator, type Log, requireRole, type UnitOfWork } from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import { buildingToday, type StaffContext, type StaffRole } from '@rms/shared-types'
import { type DebtReminderSentPayload, FAN_OUT_CHUNK, FINANCE_EVENTS } from '../../contracts'
import type { DebtRepository } from '../../domain/debt-repository'
import { RequestRuleError } from '../../domain/errors'
import type { BuildingCalendar } from '../ports'

/** The Manager's and the Admin's (DOC-22 §8.5, FR-12.4, DOC-35 §4.1). */
export const SEND_DEBT_REMINDERS_ROLES = [
  'admin',
  'manager',
] as const satisfies readonly StaffRole[]

/** `reminder:account:<id>`, `DEBT_REMINDER_PER_HOUR` per hour (DOC-22 §8.5, DR-64); throws `RateLimitedError` with `Retry-After` when empty (LG-40). */
export interface ReminderRateLimiter {
  take(accountId: string): Promise<void>
}

/** A reminder request carries 1 to 500 units (DOC-22 §8.5 step 1, §13, DR-267 item 5). */
export const DEBT_REMINDER_MAX_UNITS = 500

export interface RemindersSent {
  readonly sent: number
  readonly alreadyRemindedToday: number
  readonly noDebt: number
}

/**
 * `POST /staff/debts/reminders { unitIds }` (E-103, DOC-22 §8.5, FR-12.4, DR-267 item 5): one transaction that computes each
 * unit's outstanding, inserts one `debt_reminder` row per unit with `ON CONFLICT (building_id, unit_id, reminder_day) DO NOTHING
 * RETURNING` (a row means "send", no row means "reminded today already") and writes `finance.debt_reminder_sent.v1` in parts of
 * at most 500 (DOC-15 §10.3). The day is the **building** day, so a reminder at 23:30 and one at 00:30 local are two reminders.
 * Sending is not audited: the rows are its trace (DOC-22 §2.4). No retry; the unique key makes a conflict mean "reminded".
 */
export class SendDebtReminders {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly debts: DebtRepository,
    private readonly calendar: BuildingCalendar,
    private readonly outbox: OutboxWriter,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly logger: Log,
    private readonly limiter?: ReminderRateLimiter,
  ) {}

  async execute(
    staff: StaffContext,
    input: { readonly unitIds: readonly string[] },
  ): Promise<RemindersSent> {
    requireRole(staff, SEND_DEBT_REMINDERS_ROLES)
    const unitIds = [...new Set(input.unitIds)]
    if (unitIds.length === 0)
      throw new RequestRuleError('unitIds', 'no_unit_selected', 'Select at least one unit')
    if (unitIds.length > DEBT_REMINDER_MAX_UNITS)
      throw new RequestRuleError(
        'unitIds',
        'too_many_units',
        `At most ${DEBT_REMINDER_MAX_UNITS} units`,
      )
    // A request refused for its body takes no token (DOC-22 §8.5); the bucket is the account's, not the building's.
    await this.limiter?.take(staff.staffId)
    const scope = staff.scope
    const today = buildingToday(this.clock.now(), await this.calendar.timeZone(scope.buildingId))
    const result = await this.uow.run(async () => {
      const owing = await this.debts.byUnits(scope, today, unitIds)
      const written = await this.debts.insertReminders(
        scope,
        today,
        staff.staffId,
        owing.map((debt) => ({
          id: this.ids.next(),
          unitId: debt.unitId,
          chargeCount: debt.openCharges,
          amount: debt.outstanding,
        })),
      )
      const parts = Math.ceil(written.length / FAN_OUT_CHUNK)
      if (parts > 0) {
        const now = this.clock.now()
        await this.outbox.add(
          Array.from({ length: parts }, (_, i) => {
            const chunk = written.slice(i * FAN_OUT_CHUNK, (i + 1) * FAN_OUT_CHUNK)
            return {
              type: FINANCE_EVENTS.debtReminderSent,
              aggregateId: scope.buildingId,
              payload: {
                buildingId: scope.buildingId,
                reminderDate: today,
                part: i + 1,
                parts,
                reminders: chunk.map((row) => ({
                  reminderId: row.reminderId,
                  unitId: row.unitId,
                })),
              } satisfies DebtReminderSentPayload,
              occurredAt: now,
            }
          }),
        )
      }
      return {
        sent: written.length,
        alreadyRemindedToday: owing.length - written.length,
        noDebt: unitIds.length - owing.length,
      }
    })
    this.logger.info(
      {
        event: 'reminders.sent',
        buildingId: scope.buildingId,
        sent: result.sent,
        skipped: result.alreadyRemindedToday + result.noDebt,
      },
      'debt reminders sent',
    )
    return result
  }
}
