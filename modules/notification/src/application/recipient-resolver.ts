import type { Capability, StaffRole } from '@rms/shared-types'
import type { Recipients } from '../contracts'
import type { InboxRecipient } from '../domain/inbox-entry'
import type { NotificationRecipients } from './ports'

/**
 * DOC-31 §4.1 step 3: turn one plan's `Recipients` into the `{accountKind, accountId, unitId}` rows an entry needs, for all
 * five kinds. Every paginated call is read to its last page (DOC-09 §7.1) and the rows are de-duplicated by
 * (accountKind, accountId, unitId). A `resident` with a unit is kept only while its membership is `active`; a `staff` only
 * while the account is `active` (DOC-31 §4.1, §11). A participant is never called back with a table read: only the contracts
 * of §2.3.
 */
export class RecipientResolver {
  constructor(private readonly recipients: NotificationRecipients) {}

  async resolve(recipients: Recipients, buildingId: string): Promise<InboxRecipient[]> {
    switch (recipients.kind) {
      case 'unit_members':
        return dedupe(await this.unitMembers(recipients.unitId, recipients.capability))
      case 'staff_roles':
        return dedupe(await this.staffRoles(buildingId, recipients.roles))
      case 'resident':
        return dedupe(await this.resident(recipients.accountId, recipients.unitId))
      case 'staff':
        return dedupe(await this.staff(recipients.staffId))
      case 'accounts':
        return dedupe(
          recipients.accounts.map((account) => ({
            accountKind: account.accountKind,
            accountId: account.accountId,
            unitId: null,
          })),
        )
    }
  }

  /** Every page of `listRecipients` (DOC-09 §7.2); the plan's unit is the unit of each row. */
  private async unitMembers(unitId: string, capability: Capability): Promise<InboxRecipient[]> {
    const rows: InboxRecipient[] = []
    let after: string | undefined
    for (;;) {
      const page = await this.recipients.residency.listRecipients(
        unitId,
        capability,
        after === undefined ? undefined : { after },
      )
      for (const item of page.items)
        rows.push({ accountKind: 'resident', accountId: item.accountId, unitId })
      if (page.next === null) return rows
      after = page.next
    }
  }

  /** Every page of `listActiveStaff`; a staff entry has no unit (DOC-31 §4.2, `ck_inbox_entry_staff_unit`). */
  private async staffRoles(buildingId: string, roles: StaffRole[]): Promise<InboxRecipient[]> {
    const rows: InboxRecipient[] = []
    let after: string | undefined
    for (;;) {
      const page = await this.recipients.identity.listActiveStaff(
        buildingId,
        roles,
        after === undefined ? undefined : { after },
      )
      for (const staff of page.items)
        rows.push({ accountKind: 'staff', accountId: staff.staffId, unitId: null })
      if (page.next === null) return rows
      after = page.next
    }
  }

  /** With a unit: only an `active` membership; without one (a notice): as given (DOC-31 §4.1 step 3). */
  private async resident(accountId: string, unitId: string | null): Promise<InboxRecipient[]> {
    if (unitId === null) return [{ accountKind: 'resident', accountId, unitId: null }]
    const membership = await this.recipients.residency.getMembership(accountId, unitId)
    return membership?.status === 'active' ? [{ accountKind: 'resident', accountId, unitId }] : []
  }

  /** Only an `active` staff member (DOC-31 §4.1 step 3, NT-17). */
  private async staff(staffId: string): Promise<InboxRecipient[]> {
    const staff = await this.recipients.identity.getStaff([staffId])
    return staff.some((row) => row.staffId === staffId && row.status === 'active')
      ? [{ accountKind: 'staff', accountId: staffId, unitId: null }]
      : []
  }
}

/** DOC-31 §4.1 step 3: the same account and unit is one row, whatever a contract returned twice. */
function dedupe(rows: readonly InboxRecipient[]): InboxRecipient[] {
  const seen = new Set<string>()
  const unique: InboxRecipient[] = []
  for (const row of rows) {
    const key = `${row.accountKind}\u0000${row.accountId}\u0000${row.unitId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(row)
  }
  return unique
}
