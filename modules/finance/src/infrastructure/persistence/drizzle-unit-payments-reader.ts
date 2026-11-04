import type { Database } from '@core/db'
import { type BuildingScope, money } from '@rms/shared-types'
import { type SQL, sql } from 'drizzle-orm'
import type { PaymentSource } from '../../domain/receipt-snapshot'
import type {
  UnitMoneyLogFlag,
  UnitPaymentCursor,
  UnitPaymentReceipt,
  UnitPaymentRow,
  UnitPaymentsReader,
} from '../../domain/unit-payments-reader'

const asInstant = (value: Date | string): Date => (value instanceof Date ? value : new Date(value))

/** One `finance.payment` row before conversion (DOC-66 §5). */
interface PaymentRaw {
  readonly id: string
  readonly source: string
  readonly amount: string
  readonly received_at: Date | string
  readonly payer_name: string | null
  readonly status: string
}

/** One `finance.receipt` row of the page (DOC-66 §5). */
interface ReceiptRaw {
  readonly id: string
  readonly number: string
  readonly payment_id: string
  readonly charge_id: string
  readonly status: string
}

/** One open `finance.gateway_event` flag row (DR-327). */
interface FlagRaw {
  readonly payment_id: string
  readonly row_id: string
  readonly outcome: string
}

const uuidArray = (ids: readonly string[]): SQL =>
  sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`

/**
 * The payments read of E-102 (DOC-66 §5, DR-327): the unit's payments newest first by `(received_at, id)`, each with its
 * receipts and the refund/dispute money-log flags of the payment. The Drizzle adapter of `UnitPaymentsReader`; the receipts and
 * the flags are read in two extra queries for the whole page, never one per payment (DOC-12 §4.5). Every read carries the scope.
 */
export class DrizzleUnitPaymentsReader implements UnitPaymentsReader {
  constructor(private readonly database: Database) {}

  async payments(
    scope: BuildingScope,
    unitId: string,
    after: UnitPaymentCursor | undefined,
    limit: number,
  ): Promise<readonly UnitPaymentRow[]> {
    const keyset = after
      ? sql`AND (p.received_at, p.id) < (${after.receivedAt.toISOString()}::timestamptz, ${after.paymentId}::uuid)`
      : sql``
    const rows = (await this.database.executor.execute(sql`
      SELECT p.id AS id, p.source AS source, p.amount AS amount, p.received_at AS received_at,
             p.payer_name AS payer_name, p.status AS status
        FROM finance.payment p
       WHERE p.building_id = ${scope.buildingId} AND p.unit_id = ${unitId}
         ${keyset}
       ORDER BY p.received_at DESC, p.id DESC LIMIT ${limit}`)) as unknown as PaymentRaw[]
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)
    const [receipts, flags] = await Promise.all([
      this.receiptsOf(scope, ids),
      this.flagsOf(scope, ids),
    ])
    return rows.map((row) => ({
      paymentId: row.id,
      source: row.source as PaymentSource,
      amount: money(Number(row.amount)),
      receivedAt: asInstant(row.received_at),
      payerName: row.payer_name,
      status: row.status as 'posted' | 'void',
      moneyLogFlags: flags.get(row.id) ?? [],
      receipts: receipts.get(row.id) ?? [],
    }))
  }

  /** The receipts of the page's payments, grouped by payment id, `issued_at` order (DOC-66 §5). */
  private async receiptsOf(
    scope: BuildingScope,
    paymentIds: readonly string[],
  ): Promise<Map<string, UnitPaymentReceipt[]>> {
    const rows = (await this.database.executor.execute(sql`
      SELECT r.id AS id, r.number AS number, r.payment_id AS payment_id, r.charge_id AS charge_id,
             r.status AS status
        FROM finance.receipt r
       WHERE r.building_id = ${scope.buildingId} AND r.payment_id = ANY (${uuidArray(paymentIds)})
       ORDER BY r.issued_at, r.id`)) as unknown as ReceiptRaw[]
    const byPayment = new Map<string, UnitPaymentReceipt[]>()
    for (const row of rows) {
      const list = byPayment.get(row.payment_id) ?? []
      list.push({
        id: row.id,
        number: row.number,
        chargeId: row.charge_id,
        status: row.status as 'issued' | 'void',
      })
      byPayment.set(row.payment_id, list)
    }
    return byPayment
  }

  /**
   * The open money-log flags of the page's payments (DOC-66 §5, DR-327): `gateway_event` rows whose `related_payment_id` names the
   * payment and that are unreviewed and not `pending` or `posted` (`refunded` or `disputed`). A payment with none is absent.
   */
  private async flagsOf(
    scope: BuildingScope,
    paymentIds: readonly string[],
  ): Promise<Map<string, UnitMoneyLogFlag[]>> {
    const rows = (await this.database.executor.execute(sql`
      SELECT g.related_payment_id AS payment_id, g.id AS row_id, g.outcome AS outcome
        FROM finance.gateway_event g
       WHERE g.building_id = ${scope.buildingId} AND g.related_payment_id = ANY (${uuidArray(paymentIds)})
         AND g.outcome NOT IN ('pending', 'posted') AND g.reviewed_at IS NULL
       ORDER BY g.received_at, g.id`)) as unknown as FlagRaw[]
    const byPayment = new Map<string, UnitMoneyLogFlag[]>()
    for (const row of rows) {
      const list = byPayment.get(row.payment_id) ?? []
      list.push({ rowId: row.row_id, outcome: row.outcome })
      byPayment.set(row.payment_id, list)
    }
    return byPayment
  }
}
