import type { NewDeviceToken, PushDevice } from './device-token'
import type { AccountKind } from './inbox-entry'

/** The answer of a registration: the row id (stable across a reassignment) and whether it was inserted (DOC-31 §5.1). */
export interface RegisteredDevice {
  readonly id: string
  readonly inserted: boolean
}

/**
 * `notification.device_token` (DOC-17 §6.2, DOC-31 §5). No `building_id`: a token belongs to a device of an account that
 * spans buildings, so the methods narrow by account, session or id (DOC-14 §5.3).
 */
export interface DeviceTokenRepository {
  /** DOC-31 §5.1: the two statements in one transaction; the same token keeps its id after a reassignment (OPM-S19). */
  register(token: NewDeviceToken): Promise<RegisteredDevice>
  /** E-23/E-35: the caller removes its own token (OPM-S20); returns the rows deleted. */
  removeOwn(id: string, kind: AccountKind, accountId: string): Promise<number>
  /** `identity.session_revoked.v1`: drops the tokens of the revoked session (OPM-S20). */
  deleteBySession(sessionId: string, kind: AccountKind, accountId: string): Promise<number>
  /** `identity.account_deletion_executed.v1`: drops every token of the account. */
  deleteByAccount(kind: AccountKind, accountId: string): Promise<number>
  /** The tokens of the sessions the sender found dead (DOC-31 §6.2 step 4). */
  deleteByIds(ids: readonly string[]): Promise<number>
  /** The tokens of `accountIds` with no ticket for `messageId`, the anti-join of OPM-S21 (DOC-31 §6.2 step 3). */
  findForPush(
    kind: AccountKind,
    accountIds: readonly string[],
    messageId: string,
  ): Promise<readonly PushDevice[]>
}
