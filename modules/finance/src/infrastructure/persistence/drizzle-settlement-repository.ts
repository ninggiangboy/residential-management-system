import { type Database, inBuilding } from '@core/db'
import { type BuildingScope, money } from '@rms/shared-types'
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import type {
  GatewayEventOutcome,
  IntentStatus,
  NewGatewayEvent,
  SettlementRepository,
  SettlingIntent,
} from '../../domain/settlement-repository'
import { gatewayEvent, paymentIntent, paymentIntentItem } from './schema'

/** The statements of `settle()` (DOC-23 §6.1) on the intent, its items and the money log. */
export class DrizzleSettlementRepository implements SettlementRepository {
  constructor(private readonly database: Database) {}

  async findIntentByOrderCode(
    scope: BuildingScope,
    orderCode: number,
  ): Promise<SettlingIntent | null> {
    const [row] = await this.database.executor
      .select({
        id: paymentIntent.id,
        unitId: paymentIntent.unitId,
        code: paymentIntent.code,
        amount: paymentIntent.amount,
        status: paymentIntent.status,
        createdBy: paymentIntent.createdBy,
      })
      .from(paymentIntent)
      .where(and(inBuilding(paymentIntent, scope), eq(paymentIntent.orderCode, orderCode)))
      .limit(1)
    return row ? { ...row, amount: money(row.amount), status: row.status as IntentStatus } : null
  }

  // scope-ok: foreign_building check of DR-29 step 1 reads one boolean across buildings (DR-282)
  async orderCodeExistsAnywhere(orderCode: number): Promise<boolean> {
    // scope-ok: the one unscoped existence read of DR-282 item 1, before any write
    const rows = (await this.database.executor.execute(
      sql`SELECT EXISTS (SELECT 1 FROM finance.payment_intent WHERE order_code = ${orderCode}) AS elsewhere`,
    )) as unknown as Array<{ elsewhere: boolean }>
    return rows[0]?.elsewhere === true
  }

  async recordEvent(scope: BuildingScope, event: NewGatewayEvent): Promise<boolean> {
    const rows = await this.database.executor
      .insert(gatewayEvent)
      .values({
        id: event.id,
        buildingId: scope.buildingId,
        provider: event.provider,
        reference: event.reference,
        orderCode: event.orderCode,
        amount: Number(event.amount),
        paidAt: event.paidAt,
        source: event.source,
        payload: event.payload,
        intentId: event.intentId,
        unitId: event.unitId,
        outcome: 'pending',
      })
      .onConflictDoNothing({ target: [gatewayEvent.provider, gatewayEvent.reference] })
      .returning({ id: gatewayEvent.id })
    return rows.length === 1
  }

  async setEventOutcome(
    scope: BuildingScope,
    eventId: string,
    outcome: GatewayEventOutcome,
    paymentId: string | null,
  ): Promise<void> {
    await this.database.executor
      .update(gatewayEvent)
      .set({ outcome, paymentId })
      .where(
        and(
          inBuilding(gatewayEvent, scope),
          eq(gatewayEvent.id, eventId),
          eq(gatewayEvent.outcome, 'pending'),
        ),
      )
  }

  async claimIntent(
    scope: BuildingScope,
    intentId: string,
    paidAt: Date,
    reference: string,
  ): Promise<boolean> {
    const rows = await this.database.executor
      .update(paymentIntent)
      .set({
        status: 'paid',
        paidAt,
        gatewayReference: reference,
        nextCheckAt: null,
        version: sql`${paymentIntent.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          inBuilding(paymentIntent, scope),
          eq(paymentIntent.id, intentId),
          ne(paymentIntent.status, 'paid'),
        ),
      )
      .returning({ id: paymentIntent.id })
    return rows.length === 1
  }

  async intentItems(
    scope: BuildingScope,
    intentId: string,
  ): Promise<
    ReadonlyArray<{ readonly chargeId: string; readonly amount: ReturnType<typeof money> }>
  > {
    const rows = await this.database.executor
      .select({ chargeId: paymentIntentItem.chargeId, amount: paymentIntentItem.amount })
      .from(paymentIntentItem)
      .where(and(inBuilding(paymentIntentItem, scope), eq(paymentIntentItem.intentId, intentId)))
      .orderBy(asc(paymentIntentItem.chargeId))
    return rows.map((row) => ({ chargeId: row.chargeId, amount: money(row.amount) }))
  }
}
