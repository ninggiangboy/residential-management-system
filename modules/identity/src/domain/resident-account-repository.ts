import type {
  DeletionRequest,
  NewResidentAccount,
  ResidentAccountRecord,
  ResidentAccountTransition,
} from './resident-account'

/**
 * Resident accounts as the sign-in reads and moves them. A resident account has no building (DOC-16 §4.2), so nothing here is
 * scoped; the rules live in `ResidentAccount`, and a write is one guarded statement (`apply`).
 */
export interface ResidentAccountRepository {
  /** The account of a phone that may still sign in: `active` or `deletion_requested` (DOC-26 §5.1 step 2). */
  findSignInByPhone(phone: string): Promise<ResidentAccountRecord | null>
  findById(id: string): Promise<ResidentAccountRecord | null>
  findByIds(ids: readonly string[]): Promise<ResidentAccountRecord[]>
  /** The accounts of the numbers that are not `deleted`, one query. */
  findByPhones(phones: readonly string[]): Promise<ResidentAccountRecord[]>
  /**
   * Inserts the account unless the phone has one: `true` when this call created it. The unique index on the phone decides a race
   * (`ON CONFLICT DO NOTHING`), so two callers get one account.
   */
  insertIfAbsent(account: NewResidentAccount, now: Date): Promise<boolean>
  /** Accounts that are not `deleted` whose phone ends with `digits`, by the reversed-phone index, at most `limit`. */
  findByPhoneSuffix(digits: string, limit: number): Promise<ResidentAccountRecord[]>
  /** The accounts in `deletion_requested`, oldest id first, one more than `limit` is not read: the caller passes `limit + 1`. */
  listDeletionRequests(after: string | undefined, limit: number): Promise<DeletionRequest[]>
  /** The ids of the flagged demo accounts, for the boot guard (DOC-16 §4.2). */
  demoAccountIds(): Promise<string[]>
  /** `false`: the row moved since it was loaded (another refresh stamped it first). */
  apply(transition: ResidentAccountTransition, now: Date): Promise<boolean>
}
