import type { Database } from '@core/db'
import { type BuildingScope, type LocalDate, type Money, money } from '@rms/shared-types'
import { sql } from 'drizzle-orm'
import { AGING_BUCKETS, type AgingBucket } from '../../domain/aging'
import type {
  AgingRow,
  CollectionRow,
  DebtRepository,
  OpenChargeOfUnit,
  UnitDebt,
} from '../../domain/debt-repository'
import { debtReminder } from './schema'

/**
 * A raw `date` or `timestamptz` reaches the adapter as a `Date` (the driver parses 1082/1184).
 * A `LocalDate` is the calendar day of a date, and a `null` instant stays `null` (FR-05.6).
 */
const asLocalDate = (value: Date | string): LocalDate =>
  (value instanceof Date ? value.toISOString().slice(0, 10) : value) as LocalDate

const asInstant = (value: Date | string | null): Date | null =>
  value === null ? null : value instanceof Date ? value : new Date(value)

/** One row of the E-101 aggregate before `Money`/`LocalDate` conversion (DOC-22 §8.2). */
interface UnitDebtRow {
  readonly unit_id: string
  readonly outstanding: string
  readonly open_charges: string
  readonly oldest_due: Date | string
  readonly max_days_past_due: number
  readonly overdue_30: string
}

const toUnitDebt = (row: UnitDebtRow): UnitDebt => ({
  unitId: row.unit_id,
  outstanding: money(Number(row.outstanding)),
  openCharges: Number(row.open_charges),
  oldestDue: asLocalDate(row.oldest_due),
  maxDaysPastDue: Number(row.max_days_past_due),
  overdue30: money(Number(row.overdue_30)),
})

/** One open charge of a unit with its batch and the active intent (DOC-22 §8.2, FR-05.6). */
interface OpenChargeRow {
  readonly id: string
  readonly amount: string
  readonly version: number
  readonly code: string
  readonly name: { readonly vi: string; readonly en?: string }
  readonly fee_month: Date | string
  readonly due_date: Date | string
  readonly days_past_due: number
  readonly active_intent_since: Date | string | null
}

/** One aging row before `Money`/`LocalDate` conversion (DOC-22 §8.2). */
interface AgingRowRaw {
  readonly bucket: AgingBucket
  readonly units: string
  readonly charges: string
  readonly amount: string
}

/** One collection row before `Money`/`LocalDate` conversion (DOC-22 §8.1). */
interface CollectionRowRaw {
  readonly fee_month: Date | string
  readonly billed: string
  readonly paid: string
}

/**
 * The debt reads of DOC-22 §8.2, the collection rate of §8.1 and the reminders of §8.5 (DR-267).
 * "Open" is an `open` charge of a `published` or `closed` batch (DR-18).
 * The building day is the caller's, computed once per request (DR-09).
 */
export class DrizzleDebtRepository implements DebtRepository {
  constructor(private readonly database: Database) {}

  async list(
    scope: BuildingScope,
    today: LocalDate,
    page: {
      readonly after?: { readonly outstanding: Money; readonly unitId: string }
      readonly limit: number
    },
  ): Promise<readonly UnitDebt[]> {
    const after = page.after
    const keyset = after
      ? sql`HAVING (sum(c.amount), c.unit_id)
              < (${Number(after.outstanding)}::bigint, ${after.unitId}::uuid)`
      : sql``
    const rows = (await this.database.executor.execute(sql`
      SELECT c.unit_id AS unit_id, sum(c.amount) AS outstanding, count(*) AS open_charges,
             min(b.due_date)::text AS oldest_due, max(${today}::date - b.due_date) AS max_days_past_due,
             coalesce(sum(c.amount) FILTER (WHERE ${today}::date - b.due_date > 30), 0) AS overdue_30
        FROM finance.charge c JOIN finance.fee_batch b ON b.id = c.batch_id
       WHERE c.building_id = ${scope.buildingId} AND c.status = 'open'
         AND b.status IN ('published', 'closed')
       GROUP BY c.unit_id
       ${keyset}
       ORDER BY outstanding DESC, c.unit_id DESC LIMIT ${page.limit}`)) as unknown as UnitDebtRow[]
    return rows.map(toUnitDebt)
  }

  async byUnits(
    scope: BuildingScope,
    today: LocalDate,
    unitIds: readonly string[],
  ): Promise<readonly UnitDebt[]> {
    if (unitIds.length === 0) return []
    const ids = sql`ARRAY[${sql.join(
      unitIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::uuid[]`
    const rows = (await this.database.executor.execute(sql`
      SELECT c.unit_id AS unit_id, sum(c.amount) AS outstanding, count(*) AS open_charges,
             min(b.due_date)::text AS oldest_due, max(${today}::date - b.due_date) AS max_days_past_due,
             coalesce(sum(c.amount) FILTER (WHERE ${today}::date - b.due_date > 30), 0) AS overdue_30
        FROM finance.charge c JOIN finance.fee_batch b ON b.id = c.batch_id
       WHERE c.building_id = ${scope.buildingId} AND c.unit_id = ANY (${ids})
         AND c.status = 'open' AND b.status IN ('published', 'closed')
       GROUP BY c.unit_id
       ORDER BY outstanding DESC, c.unit_id DESC`)) as unknown as UnitDebtRow[]
    return rows.map(toUnitDebt)
  }

  async openChargesOfUnit(
    scope: BuildingScope,
    today: LocalDate,
    unitId: string,
  ): Promise<readonly OpenChargeOfUnit[]> {
    const rows = (await this.database.executor.execute(sql`
      SELECT c.id AS id, c.amount AS amount, c.version AS version, b.code AS code, b.name AS name,
             b.fee_month::text AS fee_month, b.due_date::text AS due_date,
             (${today}::date - b.due_date) AS days_past_due, i.created_at AS active_intent_since
        FROM finance.charge c JOIN finance.fee_batch b ON b.id = c.batch_id
        LEFT JOIN finance.payment_intent_item it
               ON it.charge_id = c.id AND it.released_at IS NULL
              AND it.building_id = ${scope.buildingId}
        LEFT JOIN finance.payment_intent i
               ON i.id = it.intent_id AND i.building_id = ${scope.buildingId}
              AND i.status IN ('creating', 'pending', 'cancelling')
       WHERE c.building_id = ${scope.buildingId} AND c.unit_id = ${unitId}
         AND c.status = 'open' AND b.status IN ('published', 'closed')
       ORDER BY b.fee_month, c.id`)) as unknown as OpenChargeRow[]
    return rows.map((row) => ({
      chargeId: row.id,
      amount: money(Number(row.amount)),
      version: Number(row.version),
      batchCode: row.code,
      batchName: row.name,
      feeMonth: asLocalDate(row.fee_month),
      dueDate: asLocalDate(row.due_date),
      daysPastDue: Number(row.days_past_due),
      activeIntentSince: asInstant(row.active_intent_since),
    }))
  }

  async aging(scope: BuildingScope, today: LocalDate): Promise<readonly AgingRow[]> {
    const rows = (await this.database.executor.execute(sql`
      SELECT CASE WHEN d <= 0 THEN 'not_yet_due' WHEN d <= 30 THEN '1-30'
                  WHEN d <= 60 THEN '31-60' WHEN d <= 90 THEN '61-90' ELSE 'over_90' END AS bucket,
             count(DISTINCT unit_id) AS units, count(*) AS charges, sum(amount) AS amount
        FROM (SELECT c.unit_id, c.amount, (${today}::date - b.due_date) AS d
                FROM finance.charge c JOIN finance.fee_batch b ON b.id = c.batch_id
               WHERE c.building_id = ${scope.buildingId} AND c.status = 'open'
                 AND b.status IN ('published', 'closed')) x
       GROUP BY 1`)) as unknown as AgingRowRaw[]
    return rows
      .map((row) => ({
        bucket: row.bucket,
        units: Number(row.units),
        charges: Number(row.charges),
        amount: money(Number(row.amount)),
      }))
      .sort((a, b) => AGING_BUCKETS.indexOf(a.bucket) - AGING_BUCKETS.indexOf(b.bucket))
  }

  async collectionByMonth(scope: BuildingScope): Promise<readonly CollectionRow[]> {
    const rows = (await this.database.executor.execute(sql`
      SELECT b.fee_month::text AS fee_month, sum(c.amount) AS billed,
             coalesce(sum(c.amount) FILTER (WHERE c.status = 'paid'), 0) AS paid
        FROM finance.fee_batch b
        JOIN finance.charge c ON c.batch_id = b.id AND c.building_id = b.building_id
       WHERE b.building_id = ${scope.buildingId} AND b.status IN ('published', 'closed')
         AND c.status <> 'void' AND c.status <> 'draft'
       GROUP BY b.fee_month
       ORDER BY b.fee_month`)) as unknown as CollectionRowRaw[]
    return rows.map((row) => ({
      feeMonth: asLocalDate(row.fee_month),
      billed: money(Number(row.billed)),
      paid: money(Number(row.paid)),
    }))
  }

  async insertReminders(
    scope: BuildingScope,
    day: LocalDate,
    sentBy: string,
    reminders: ReadonlyArray<{
      readonly id: string
      readonly unitId: string
      readonly chargeCount: number
      readonly amount: Money
    }>,
  ): Promise<ReadonlyArray<{ readonly reminderId: string; readonly unitId: string }>> {
    if (reminders.length === 0) return []
    return this.database.executor
      .insert(debtReminder)
      .values(
        reminders.map((row) => ({
          id: row.id,
          buildingId: scope.buildingId,
          unitId: row.unitId,
          reminderDay: day,
          sentBy,
          chargeCount: row.chargeCount,
          amount: Number(row.amount),
        })),
      )
      .onConflictDoNothing({
        target: [debtReminder.buildingId, debtReminder.unitId, debtReminder.reminderDay],
      })
      .returning({ reminderId: debtReminder.id, unitId: debtReminder.unitId })
  }
}
