import type { Database } from '@core/db'
import { InvariantError } from '@core/kernel'
import { sql } from 'drizzle-orm'
import type { NewDeviceToken, PushDevice } from '../../domain/device-token'
import type { DeviceTokenRepository, RegisteredDevice } from '../../domain/device-token-repository'
import type { AccountKind } from '../../domain/inbox-entry'

/** One `findForPush` row (DOC-31 §6.2 step 3, OPM-S21). */
type PushDeviceRow = {
  readonly id: string
  readonly account_id: string
  readonly session_id: string
  readonly expo_push_token: string
  readonly platform: string
}

/** `notification.device_token` (DOC-17 §6.2); no `building_id`, so it narrows by account, session or id (DOC-14 §5.3). */
export class DrizzleDeviceTokenRepository implements DeviceTokenRepository {
  constructor(private readonly database: Database) {}

  /** The two statements of DOC-31 §5.1 in one transaction (OPM-S19). */
  async register(token: NewDeviceToken): Promise<RegisteredDevice> {
    return this.database.transaction(async () => {
      await this.database.executor.execute(sql`
        DELETE FROM notification.device_token
         WHERE session_id = ${token.sessionId}::uuid AND expo_push_token <> ${token.expoPushToken}`)
      const [row] = await this.database.executor.execute<{ id: string; inserted: boolean }>(sql`
        INSERT INTO notification.device_token AS t
          (id, account_kind, account_id, session_id, expo_push_token, platform, app_version)
        VALUES (${token.id}::uuid, ${token.accountKind}, ${token.accountId}::uuid, ${token.sessionId}::uuid,
                ${token.expoPushToken}, ${token.platform}, ${token.appVersion})
        ON CONFLICT ON CONSTRAINT uq_device_token_token DO UPDATE
           SET account_kind = excluded.account_kind, account_id = excluded.account_id,
               session_id = excluded.session_id, platform = excluded.platform,
               app_version = excluded.app_version, updated_at = now()
        RETURNING t.id, (xmax = 0) AS inserted`)
      if (!row) throw new InvariantError('the device_token registration returned no row')
      return { id: row.id, inserted: row.inserted }
    })
  }

  /** E-23/E-35: the caller removes its own token (OPM-S20); returns the rows deleted. */
  async removeOwn(id: string, kind: AccountKind, accountId: string): Promise<number> {
    const deleted = await this.database.executor.execute(sql`
      DELETE FROM notification.device_token
       WHERE id = ${id}::uuid AND account_kind = ${kind} AND account_id = ${accountId}::uuid`)
    return deleted.count
  }

  /** `identity.session_revoked.v1`: drops the tokens of the revoked session (OPM-S20). */
  async deleteBySession(sessionId: string, kind: AccountKind, accountId: string): Promise<number> {
    const deleted = await this.database.executor.execute(sql`
      DELETE FROM notification.device_token
       WHERE session_id = ${sessionId}::uuid AND account_kind = ${kind} AND account_id = ${accountId}::uuid`)
    return deleted.count
  }

  /** `identity.account_deletion_executed.v1`: drops every token of the account. */
  async deleteByAccount(kind: AccountKind, accountId: string): Promise<number> {
    const deleted = await this.database.executor.execute(sql`
      DELETE FROM notification.device_token
       WHERE account_kind = ${kind} AND account_id = ${accountId}::uuid`)
    return deleted.count
  }

  /** The tokens of the sessions the sender found dead (DOC-31 §6.2 step 4). */
  async deleteByIds(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0
    const deleted = await this.database.executor.execute(sql`
      DELETE FROM notification.device_token WHERE id = ANY (${sql.param(ids)}::uuid[])`)
    return deleted.count
  }

  /** The tokens of `accountIds` with no ticket for `messageId` (DOC-31 §6.2 step 3, OPM-S21). */
  async findForPush(
    kind: AccountKind,
    accountIds: readonly string[],
    messageId: string,
  ): Promise<readonly PushDevice[]> {
    if (accountIds.length === 0) return []
    const rows = await this.database.executor.execute<PushDeviceRow>(sql`
      SELECT t.id, t.account_id, t.session_id, t.expo_push_token, t.platform
        FROM notification.device_token t
       WHERE t.account_kind = ${kind}
         AND t.account_id = ANY (${sql.param(accountIds)}::uuid[])
         AND NOT EXISTS (SELECT 1 FROM notification.push_ticket p
                          WHERE p.message_id = ${messageId}::uuid AND p.device_token_id = t.id)`)
    return rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      sessionId: row.session_id,
      expoPushToken: row.expo_push_token,
      platform: row.platform as PushDevice['platform'],
    }))
  }
}
