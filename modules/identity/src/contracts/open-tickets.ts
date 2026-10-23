/** A ticket that blocks a lock, a disable or a role change: `assigned`, `accepted`, `in_progress` or `on_hold` (DOC-26 §4.4 rule 4). */
export interface OpenTicket {
  ticketId: string
  code: string
  status: string
}

/**
 * `identity` declares the question and `tickets` answers it from `integrations/identity` (DOC-12 §4.4, DOC-26 §2.1), so the
 * module graph stays acyclic: `tickets` already calls `IdentityApi.getStaff`. Both calls join the caller's transaction.
 */
export interface OpenTicketsProbe {
  openTicketsOf(staffId: string): Promise<OpenTicket[]>
  /** Moves every open ticket of `fromStaffId` to `toStaffId` and returns how many moved. */
  reassignAll(fromStaffId: string, toStaffId: string): Promise<number>
}
