import type { Database } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { sql } from 'drizzle-orm'
import type { CascadeCancelReason, IntentRepository } from '../../domain/intent-repository'

/** `finance.payment_intent` and its items for the cascade cancel of DOC-23 §5.4 and the release of DOC-23 §3. */
export class DrizzleIntentRepository implements IntentRepository {
  constructor(private readonly database: Database) {}

  async cancelHolders(
    scope: BuildingScope,
    chargeIds: readonly string[],
    reason: CascadeCancelReason,
  ): Promise<readonly string[]> {
    const ids = sql`ARRAY[${sql.join(
      chargeIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::uuid[]`
    // DOC-23 §5.4: the whole intent, including a charge of another batch in it (FR-04.1, DR-31); `cancelling` items are already released.
    const rows = (await this.database.executor.execute(sql`
      WITH holders AS (
        SELECT DISTINCT it.intent_id FROM finance.payment_intent_item it
         WHERE it.building_id = ${scope.buildingId} AND it.charge_id = ANY (${ids}) AND it.released_at IS NULL)
      UPDATE finance.payment_intent i
         SET status = 'cancelling', cancel_reason = ${reason}, cancel_requested_at = now(),
             next_check_at = now() + interval '15 minutes', version = i.version + 1, updated_at = now()
        FROM holders h
       WHERE i.id = h.intent_id AND i.building_id = ${scope.buildingId} AND i.status IN ('creating', 'pending')
      RETURNING i.id`)) as unknown as Array<{ id: string }>
    const intentIds = rows.map((row) => row.id).sort()
    if (intentIds.length === 0) return intentIds
    const held = sql`ARRAY[${sql.join(
      intentIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::uuid[]`
    await this.database.executor.execute(sql`
      UPDATE finance.payment_intent_item SET released_at = now()
       WHERE building_id = ${scope.buildingId} AND intent_id = ANY (${held}) AND released_at IS NULL`)
    return intentIds
  }

  async releaseItems(scope: BuildingScope, intentId: string): Promise<void> {
    await this.database.executor.execute(sql`
      UPDATE finance.payment_intent_item SET released_at = now()
       WHERE building_id = ${scope.buildingId} AND intent_id = ${intentId} AND released_at IS NULL`)
  }
}
