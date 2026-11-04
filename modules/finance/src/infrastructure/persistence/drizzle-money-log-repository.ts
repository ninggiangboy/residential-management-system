import { type Database, inBuilding } from '@core/db'
import { type BuildingScope, money } from '@rms/shared-types'
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import type {
  MoneyLogDetail,
  MoneyLogFilter,
  MoneyLogKind,
  MoneyLogRepository,
  MoneyLogRow,
  ReviewableState,
} from '../../domain/money-log-repository'
import { gatewayEvent, statementLine } from './schema'

/** The reviewable `statement_line` statuses (DOC-22 §9.1, DR-16); `matched` and `proposed` need no review. */
const STATEMENT_STATUSES: readonly string[] = ['unmatched', 'statement_only']

/** A filter that names one of these belongs to the statement half; any other value is a `gateway_event` outcome (DOC-22 §9.4). */
const isStatementStatus = (outcome: string | undefined): boolean =>
  outcome !== undefined && STATEMENT_STATUSES.includes(outcome)

/** The only payload keys the drawer may show; the payer's account name and number are never among them (DR-267 item 7). */
const PAYLOAD_FIELDS = [
  'reference',
  'description',
  'transactionDateTime',
  'counterAccountBankName',
] as const

/** A row of the viewer union (DOC-22 §9.4) as `execute` returns it; a driver may hand back strings for its dates. */
type RawRow = {
  readonly kind: string
  readonly id: string
  readonly at: Date | string
  readonly amount: number | string
  readonly status: string
  readonly unit_id: string | null
  readonly reviewed_at: Date | string | null
}

/** The gateway half of the drawer (FR-47.2) with its reviewer and its raw `payload`. */
type GatewayDetailRow = RawRow & {
  readonly reference: string
  readonly order_code: number | null
  readonly intent_id: string | null
  readonly payment_id: string | null
  readonly related_payment_id: string | null
  readonly reviewed_by: string | null
  readonly review_note: string | null
  readonly payload: unknown
}

/** The statement half of the drawer (FR-47.2) with its reviewer and its bank reference. */
type StatementDetailRow = RawRow & {
  readonly bank_reference: string | null
  readonly payment_id: string | null
  readonly reviewed_by: string | null
  readonly review_note: string | null
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value))

const toRow = (row: RawRow): MoneyLogRow => ({
  kind: row.kind as MoneyLogKind,
  id: row.id,
  at: toDate(row.at),
  amount: money(Number(row.amount)),
  status: row.status,
  unitId: row.unit_id,
  reviewedAt: row.reviewed_at === null ? null : toDate(row.reviewed_at),
})

/** Only the whitelisted payload fields survive; the payer's account name and number are never shown (DR-267 item 7). */
const whitelistPayload = (payload: unknown): Readonly<Record<string, unknown>> => {
  if (typeof payload !== 'object' || payload === null) return {}
  const source = payload as Record<string, unknown>
  const shown: Record<string, unknown> = {}
  for (const field of PAYLOAD_FIELDS) if (source[field] !== undefined) shown[field] = source[field]
  return shown
}

/**
 * The money log of DOC-22 §9: the once-only review of one row (§9.2), the viewer union (§9.4), the unit panel and the drawer of
 * FR-47.2. It is read-only for the ledger — nothing links a row to a charge, period or payment (DR-16, DR-84) — and the drawer
 * payload is reduced to the whitelist of DR-267 item 7, never the payer's account name or number.
 */
export class DrizzleMoneyLogRepository implements MoneyLogRepository {
  constructor(private readonly database: Database) {}

  /** The conditional update of DOC-22 §9.2; `false` on 0 rows, which the caller names as a 409 or a 404. */
  async review(
    scope: BuildingScope,
    kind: MoneyLogKind,
    id: string,
    staffId: string,
    note: string,
  ): Promise<boolean> {
    const rows =
      kind === 'gateway_event'
        ? await this.database.executor
            .update(gatewayEvent)
            .set({ reviewedBy: staffId, reviewedAt: sql`now()`, reviewNote: note })
            .where(
              and(
                inBuilding(gatewayEvent, scope),
                eq(gatewayEvent.id, id),
                notInArray(gatewayEvent.outcome, ['pending', 'posted']),
                isNull(gatewayEvent.reviewedAt),
              ),
            )
            .returning({ id: gatewayEvent.id })
        : await this.database.executor
            .update(statementLine)
            .set({
              reviewedBy: staffId,
              reviewedAt: sql`now()`,
              reviewNote: note,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                inBuilding(statementLine, scope),
                eq(statementLine.id, id),
                inArray(statementLine.matchStatus, [...STATEMENT_STATUSES]),
                isNull(statementLine.reviewedAt),
              ),
            )
            .returning({ id: statementLine.id })
    return rows.length > 0
  }

  /** The row as it reads after 0 rows, so the caller can tell a `posted` row from an already-reviewed one (DOC-22 §9.2). */
  async state(
    scope: BuildingScope,
    kind: MoneyLogKind,
    id: string,
  ): Promise<ReviewableState | null> {
    if (kind === 'gateway_event') {
      const [row] = await this.database.executor
        .select({ status: gatewayEvent.outcome, reviewedAt: gatewayEvent.reviewedAt })
        .from(gatewayEvent)
        .where(and(inBuilding(gatewayEvent, scope), eq(gatewayEvent.id, id)))
        .limit(1)
      return row ? { status: row.status, reviewedAt: row.reviewedAt } : null
    }
    const [row] = await this.database.executor
      .select({ status: statementLine.matchStatus, reviewedAt: statementLine.reviewedAt })
      .from(statementLine)
      .where(and(inBuilding(statementLine, scope), eq(statementLine.id, id)))
      .limit(1)
    return row ? { status: row.status, reviewedAt: row.reviewedAt } : null
  }

  /**
   * The union of DOC-22 §9.4 in one statement: each half carries its own `building_id` and its own filters, so it uses its own
   * index (`ix_gateway_event_building_open` with `open_only`, `ix_gateway_event_building_received` otherwise); the keyset
   * `(at, id)` and the limit are on the outer select. A `unit` filter drops the statement half, which has no unit.
   */
  async list(scope: BuildingScope, filter: MoneyLogFilter): Promise<readonly MoneyLogRow[]> {
    const gateway = [sql`g.outcome <> 'pending'`]
    if (filter.includePosted !== true) gateway.push(sql`g.outcome <> 'posted'`)
    if (filter.outcome !== undefined) gateway.push(sql`g.outcome = ${filter.outcome}`)
    if (filter.unitId !== undefined) gateway.push(sql`g.unit_id = ${filter.unitId}`)
    if (filter.from !== undefined)
      gateway.push(sql`g.received_at >= ${filter.from.toISOString()}::timestamptz`)
    if (filter.to !== undefined)
      gateway.push(sql`g.received_at < ${filter.to.toISOString()}::timestamptz`)
    const gatewayReview = reviewPredicate('g', filter)
    if (gatewayReview) gateway.push(gatewayReview)

    const gatewayHalf = sql`
      SELECT 'gateway_event' AS kind, g.id, g.received_at AS at, g.amount, g.outcome AS status,
             g.unit_id, g.reviewed_at
        FROM finance.gateway_event g
       WHERE g.building_id = ${scope.buildingId} AND ${sql.join(gateway, sql` AND `)}`

    const statement = [sql`l.match_status IN ('unmatched', 'statement_only')`]
    if (filter.outcome !== undefined) statement.push(sql`l.match_status = ${filter.outcome}`)
    if (filter.from !== undefined)
      statement.push(sql`l.booked_on::timestamptz >= ${filter.from.toISOString()}::timestamptz`)
    if (filter.to !== undefined)
      statement.push(sql`l.booked_on::timestamptz < ${filter.to.toISOString()}::timestamptz`)
    const statementReview = reviewPredicate('l', filter)
    if (statementReview) statement.push(statementReview)

    const statementHalf = sql`
      SELECT 'statement_line' AS kind, l.id, l.booked_on::timestamptz AS at, l.amount,
             l.match_status AS status, NULL::uuid AS unit_id, l.reviewed_at
        FROM finance.statement_line l
       WHERE l.building_id = ${scope.buildingId} AND ${sql.join(statement, sql` AND `)}`

    const includeStatement =
      filter.unitId === undefined &&
      (filter.outcome === undefined || isStatementStatus(filter.outcome))
    const half = includeStatement ? sql`${gatewayHalf} UNION ALL ${statementHalf}` : gatewayHalf

    const keyset =
      filter.after === undefined
        ? sql`TRUE`
        : sql`(x.at, x.id) < (${filter.after.at.toISOString()}::timestamptz, ${filter.after.id}::uuid)`

    const rows = (await this.database.executor.execute(sql`
      SELECT * FROM (${half}) x
       WHERE ${keyset}
       ORDER BY x.at DESC, x.id DESC
       LIMIT ${filter.limit}`)) as unknown as RawRow[]
    return rows.map(toRow)
  }

  /** `UnitMoneyPanel` (E-110): the unit's `gateway_event` rows, newest first, on `ix_gateway_event_building_unit`. */
  async byUnit(
    scope: BuildingScope,
    unitId: string,
    limit: number,
  ): Promise<readonly MoneyLogRow[]> {
    const rows = (await this.database.executor.execute(sql`
      SELECT 'gateway_event' AS kind, g.id, g.received_at AS at, g.amount, g.outcome AS status,
             g.unit_id, g.reviewed_at
        FROM finance.gateway_event g
       WHERE g.building_id = ${scope.buildingId} AND g.unit_id = ${unitId} AND g.outcome <> 'pending'
       ORDER BY g.received_at DESC, g.id DESC
       LIMIT ${limit}`)) as unknown as RawRow[]
    return rows.map(toRow)
  }

  /** The drawer of FR-47.2: the row, the payment links and, for a gateway event, the whitelisted payload of DR-267 item 7. */
  async detail(
    scope: BuildingScope,
    kind: MoneyLogKind,
    id: string,
  ): Promise<MoneyLogDetail | null> {
    if (kind === 'gateway_event') {
      const rows = (await this.database.executor.execute(sql`
        SELECT 'gateway_event' AS kind, g.id, g.received_at AS at, g.amount, g.outcome AS status,
               g.unit_id, g.reviewed_at, g.reference, g.order_code, g.intent_id, g.payment_id,
               g.related_payment_id, g.reviewed_by, g.review_note, g.payload
          FROM finance.gateway_event g
         WHERE g.building_id = ${scope.buildingId} AND g.id = ${id}`)) as unknown as GatewayDetailRow[]
      const row = rows[0]
      if (!row) return null
      return {
        ...toRow(row),
        reference: row.reference,
        orderCode: row.order_code,
        intentId: row.intent_id,
        paymentId: row.payment_id,
        relatedPaymentId: row.related_payment_id,
        payload: whitelistPayload(row.payload),
        reviewedBy: row.reviewed_by,
        reviewNote: row.review_note,
      }
    }
    const rows = (await this.database.executor.execute(sql`
      SELECT 'statement_line' AS kind, l.id, l.booked_on AS at, l.amount, l.match_status AS status,
             NULL::uuid AS unit_id, l.reviewed_at, l.bank_reference, l.payment_id, l.reviewed_by,
             l.review_note
        FROM finance.statement_line l
       WHERE l.building_id = ${scope.buildingId} AND l.id = ${id}`)) as unknown as StatementDetailRow[]
    const row = rows[0]
    if (!row) return null
    return {
      ...toRow(row),
      reference: row.bank_reference,
      orderCode: null,
      intentId: null,
      paymentId: row.payment_id,
      relatedPaymentId: null,
      payload: {},
      reviewedBy: row.reviewed_by,
      reviewNote: row.review_note,
    }
  }
}

/** `state=open` keeps the rows nobody reviewed, `state=reviewed` the others (E-108); neither is every row. */
function reviewPredicate(alias: 'g' | 'l', filter: MoneyLogFilter) {
  const column = sql.raw(`${alias}.reviewed_at`)
  if (filter.openOnly === true) return sql`${column} IS NULL`
  if (filter.reviewedOnly === true) return sql`${column} IS NOT NULL`
  return null
}
