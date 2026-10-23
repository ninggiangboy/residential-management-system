import type { BuildingScope, StaffRole } from '@rms/shared-types'
import type { Language, StaffStatus } from '../contracts'
import type { StaffAccountRecord, StaffAccountTransition } from './staff-account'

/**
 * Staff accounts as `identity` reads and moves them. Every time-dependent statement takes `now` from the `Clock`, so a test
 * with a fake clock decides when a lock ends (DOC-26 §12). The rules live in `StaffAccount`; a write is one guarded statement
 * (`apply`), so the database arbitrates a race and holds no rule.
 */
/** What a new staff account is born with: `invited`, no password, version 1 (DOC-16 §4.1). */
export interface NewStaffAccount {
  id: string
  buildingId: string
  email: string
  fullName: string
  role: StaffRole
  language: Language
}

/** The filters of `GET /staff/accounts` (E-39). `q` is a name with case and diacritics ignored, or the start of an email. */
export interface StaffSearch {
  role?: StaffRole
  status?: StaffStatus
  q?: string
}

export interface StaffAccountRepository {
  findByEmail(email: string): Promise<StaffAccountRecord | null>
  findById(id: string): Promise<StaffAccountRecord | null>
  findByIds(ids: readonly string[]): Promise<StaffAccountRecord[]>
  /** Only `active` staff of the roles, keyset on `id`, one more than `limit` is read to know whether there is a next page. */
  listActive(
    scope: BuildingScope,
    roles: readonly StaffRole[],
    after: string | undefined,
    limit: number,
  ): Promise<StaffAccountRecord[]>
  activeAdminIds(scope: BuildingScope): Promise<string[]>
  /** The row of the building; another building's id is `null`, so the caller answers 404 (DOC-12 §7). */
  findScoped(scope: BuildingScope, id: string): Promise<StaffAccountRecord | null>
  /** The page of E-39 ordered by `lower(full_name), id`, and the number of rows that match the filters. */
  search(
    scope: BuildingScope,
    filter: StaffSearch,
    offset: number,
    limit: number,
  ): Promise<{ rows: StaffAccountRecord[]; total: number }>
  /**
   * Locks the building's active Admin rows in `id` order and returns their ids (DOC-26 §4.4 rule 3): two Admins who lock each
   * other serialize here, and the second sees the first's change when it counts.
   */
  lockActiveAdminIds(scope: BuildingScope): Promise<string[]>
  /** Inserts the `invited` account; a taken email is SQLSTATE 23505 on `uq_staff_account_email` for the caller to map. */
  insert(scope: BuildingScope, account: NewStaffAccount, now: Date): Promise<StaffAccountRecord>

  /**
   * Applies the change an aggregate decided (DR-255) in one statement, `now` stamping `updated_at`. `false` means no row matched:
   * the state the decision read has moved, and the caller decides again or answers 409.
   */
  apply(transition: StaffAccountTransition, now: Date): Promise<boolean>
}
