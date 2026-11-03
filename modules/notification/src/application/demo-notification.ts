import type { IdGenerator } from '@core/kernel'
import type { BuildingApi } from '@mod/building/contracts'
import type { DemoCounts, DemoResettable, DemoSeedContext } from '@rms/shared-types'
import type { NewInboxEntry } from '../domain/inbox-entry'
import type { InboxEntryRepository } from '../domain/inbox-entry-repository'
import { scopeOf } from './scope-of'

/**
 * `notification`'s part of the demo reset (DOC-31 §12, DOC-36 §10.2): the entries of the demo building are deleted and written
 * again. Three entries per demo resident who holds `view_fees` (a published batch, a received payment, a notice) and one
 * `finance.money_unposted` for the demo Manager, so the first sign-in of a demo account shows a non-empty inbox. `device_token`
 * and `push_ticket` have no building: the demo's tokens die with the demo's sessions and the sender's live-session check removes
 * them (DOC-31 §6.2 step 4). There is no demo skip in the sender: a push from the demo may reach a real test device (DOC-36 §9.2).
 */
export class NotificationDemo implements DemoResettable {
  readonly module = 'notification'

  constructor(
    private readonly building: Pick<BuildingApi, 'assertDemo'>,
    private readonly entries: InboxEntryRepository,
    private readonly ids: IdGenerator,
  ) {}

  async resetDemo(buildingId: string): Promise<DemoCounts> {
    await this.building.assertDemo(buildingId)
    return { 'notification.inbox_entry': await this.entries.deleteForBuilding(buildingId) }
  }

  async seedDemo(buildingId: string, ctx: DemoSeedContext): Promise<DemoCounts> {
    await this.building.assertDemo(buildingId)
    const { plan, today } = ctx
    const unitIds = new Map(plan.units.map((unit) => [unit.code, unit.id]))
    const batch = this.ids.next()
    const payment = this.ids.next()
    const notice = this.ids.next()
    const rows: NewInboxEntry[] = []
    const entry = (
      row: Omit<NewInboxEntry, 'id' | 'dedupeId'> & { dedupeId?: string },
    ): NewInboxEntry => ({ id: this.ids.next(), dedupeId: row.sourceId, ...row })

    for (const resident of plan.residents) {
      for (const membership of resident.memberships) {
        const unitId = unitIds.get(membership.unitCode) ?? null
        if (membership.memberType === 'helper' || unitId === null) continue
        rows.push(
          entry({
            accountKind: 'resident',
            accountId: resident.id,
            unitId,
            templateKey: 'fee.batch_published',
            params: { batchCode: 'PH-DEMO-01', feeMonth: today.slice(0, 7) },
            sourceKind: 'batch',
            sourceId: batch,
          }),
          entry({
            accountKind: 'resident',
            accountId: resident.id,
            unitId,
            templateKey: 'payment.received',
            params: {},
            sourceKind: 'payment',
            sourceId: payment,
          }),
        )
      }
      rows.push(
        entry({
          accountKind: 'resident',
          accountId: resident.id,
          unitId: null,
          templateKey: 'notice.published',
          params: { noticeTitle: { vi: 'Chào mừng đến bản demo', en: 'Welcome to the demo' } },
          sourceKind: 'notice',
          sourceId: notice,
        }),
      )
    }
    const manager = plan.staff.find((person) => person.role === 'manager')
    if (manager)
      rows.push(
        entry({
          accountKind: 'staff',
          accountId: manager.id,
          unitId: null,
          templateKey: 'finance.money_unposted',
          params: {},
          sourceKind: 'gateway_event',
          sourceId: this.ids.next(),
        }),
      )
    const inserted = await this.entries.insertMany(scopeOf(buildingId), rows, 500)
    return { 'notification.inbox_entry': inserted.length }
  }
}
