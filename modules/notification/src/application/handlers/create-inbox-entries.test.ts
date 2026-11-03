import { describe, expect, test } from 'bun:test'
import type { Envelope } from '@core/messaging'
import { FakeClock, InMemoryInbox, InMemoryOutbox, SequentialIds } from '@core/testing'
import type { MemberType, MetricsPort, StaffRole } from '@rms/shared-types'
import {
  type InboxPlan,
  type InboxRule,
  NOTIFICATION_EVENTS,
  type PushRequestedPayload,
  type StaffInboxCreatedPayload,
} from '../../contracts'
import type { NewInboxEntry } from '../../domain/inbox-entry'
import type { InboxEntryRepository, InsertedInboxEntry } from '../../domain/inbox-entry-repository'
import type { NotificationRecipients } from '../ports'
import { RecipientResolver } from '../recipient-resolver'
import { CreateInboxEntries } from './create-inbox-entries'

const BUILDING = '0192f3c4-5a1e-7000-8000-000000000001'
const UNIT_1508 = '0192f3c4-5a1e-7000-8000-000000000021'
const UNIT_1509 = '0192f3c4-5a1e-7000-8000-000000000022'
const BATCH = '0192f3c4-5a1e-7000-8000-000000000010'
const PAYMENT = '0192f3c4-5a1e-7000-8000-000000000030'
const MONEY_ROW = '0192f3c4-5a1e-7000-8000-000000000034'
const AN = '0192f3c4-5a1e-7000-8000-000000000041'
const FAMILY = '0192f3c4-5a1e-7000-8000-000000000042'
const BINH = '0192f3c4-5a1e-7000-8000-000000000043'
const HELPER = '0192f3c4-5a1e-7000-8000-000000000044'
const LAM = '0192f3c4-5a1e-7000-8000-000000000051'
const ADMIN = '0192f3c4-5a1e-7000-8000-000000000052'
const DISABLED_MANAGER = '0192f3c4-5a1e-7000-8000-000000000053'

interface Member {
  accountId: string
  memberType: MemberType
  /** DOC-31 §3.2: `view_fees` holds for owner, family and tenant, never for a helper (DR-20). */
  viewFees: boolean
}

interface StaffRow {
  staffId: string
  role: StaffRole
  status: 'active' | 'disabled'
}

interface World {
  members: Map<string, Member[]>
  membership: Map<string, 'active' | 'locked'>
  staff: StaffRow[]
  /** A unit whose `listRecipients` throws, for NT-21. */
  failOn?: string
}

/** DOC-31 §14: unit A-1508 (owner, family, tenant without can_pay, a helper), A-1509 (owner An), and the staff of NT-17. */
function baseWorld(): World {
  const members = new Map<string, Member[]>()
  members.set(UNIT_1508, [
    { accountId: AN, memberType: 'owner', viewFees: true },
    { accountId: FAMILY, memberType: 'family', viewFees: true },
    { accountId: BINH, memberType: 'tenant', viewFees: true },
    { accountId: HELPER, memberType: 'helper', viewFees: false },
  ])
  members.set(UNIT_1509, [{ accountId: AN, memberType: 'owner', viewFees: true }])
  const membership = new Map<string, 'active' | 'locked'>([
    [`${AN}|${UNIT_1508}`, 'active'],
    [`${AN}|${UNIT_1509}`, 'active'],
  ])
  const staff: StaffRow[] = [
    { staffId: LAM, role: 'manager', status: 'active' },
    { staffId: ADMIN, role: 'admin', status: 'active' },
    { staffId: DISABLED_MANAGER, role: 'manager', status: 'disabled' },
  ]
  return { members, membership, staff }
}

/** NT-13: 1,201 charged units, each with two members. */
function bigWorld(): { world: World; codes: string[]; members: string[] } {
  const members = new Map<string, Member[]>()
  const codes: string[] = []
  const accounts: string[] = []
  for (let i = 0; i < 1_201; i += 1) {
    const unitId = `unit-${i}`
    const first = `member-${i}-a`
    const second = `member-${i}-b`
    codes.push(unitId)
    accounts.push(first, second)
    members.set(unitId, [
      { accountId: first, memberType: 'owner', viewFees: true },
      { accountId: second, memberType: 'family', viewFees: true },
    ])
  }
  return { world: { members, membership: new Map(), staff: [] }, codes, members: accounts }
}

/** Keyset paging as DOC-09 §7.1 does it; a page of two exercises the resolver's read of every page. */
function paginate<T>(
  rows: T[],
  after: string | null,
  size = 2,
): { items: T[]; next: string | null } {
  const start = after === null ? 0 : Number(after)
  const items = rows.slice(start, start + size)
  const next = start + size < rows.length ? String(start + size) : null
  return { items, next }
}

function makeRecipients(world: World): NotificationRecipients {
  return {
    residency: {
      async listRecipients(unitId, capability, page) {
        if (world.failOn === unitId) throw new Error('listRecipients failed')
        const members = (world.members.get(unitId) ?? []).filter(
          (member) => capability !== 'view_fees' || member.viewFees,
        )
        const rows = members.map((member) => ({
          accountId: member.accountId,
          membershipId: `mem-${member.accountId}-${unitId}`,
          memberType: member.memberType,
          canPay: true,
        }))
        return paginate(rows, page?.after ?? null)
      },
      async getMembership(accountId, unitId) {
        const explicit = world.membership.get(`${accountId}|${unitId}`)
        const present = (world.members.get(unitId) ?? []).some(
          (member) => member.accountId === accountId,
        )
        const status = explicit ?? (present ? 'active' : null)
        if (status === null) return null
        return {
          membershipId: `mem-${accountId}-${unitId}`,
          buildingId: BUILDING,
          unitId,
          accountId,
          memberType: 'owner',
          canPay: true,
          status,
          startedAt: '2026-10-01T00:00:00.000Z',
        }
      },
    },
    identity: {
      async listActiveStaff(buildingId, roles, page) {
        const rows = world.staff
          .filter((staff) => staff.status === 'active' && roles.includes(staff.role))
          .map((staff) => ({
            staffId: staff.staffId,
            buildingId,
            fullName: staff.staffId,
            role: staff.role,
            status: staff.status,
            language: 'vi' as const,
            pushEnabled: true,
          }))
        return paginate(rows, page?.after ?? null)
      },
      async getStaff(ids) {
        return world.staff
          .filter((staff) => ids.includes(staff.staffId))
          .map((staff) => ({
            staffId: staff.staffId,
            buildingId: BUILDING,
            fullName: staff.staffId,
            role: staff.role,
            status: staff.status,
            language: 'vi' as const,
            pushEnabled: true,
          }))
      },
    },
  }
}

/** The natural key of `uq_inbox_entry_dedupe` (DR-299): a second insert of the same key returns no row (NT-11). */
function fakeEntries() {
  const keys = new Set<string>()
  const rows: NewInboxEntry[] = []
  const repo = {
    async insertMany(_scope: unknown, entries: readonly NewInboxEntry[], _page: number) {
      const inserted: InsertedInboxEntry[] = []
      for (const entry of entries) {
        const key = [
          entry.sourceKind,
          entry.dedupeId,
          entry.templateKey,
          entry.accountKind,
          entry.accountId,
          entry.unitId ?? '',
        ].join('\u0000')
        if (keys.has(key)) continue
        keys.add(key)
        rows.push(entry)
        inserted.push({
          accountKind: entry.accountKind,
          accountId: entry.accountId,
          unitId: entry.unitId,
          id: entry.id,
        })
      }
      return inserted
    },
  } as unknown as InboxEntryRepository
  return { repo, rows }
}

function recordingMetrics() {
  const calls: Array<{ name: string; labels: Record<string, unknown> }> = []
  const metrics = {
    inc(name: string, labels: Record<string, unknown> = {}) {
      calls.push({ name, labels })
    },
    add(name: string, _by: number, labels: Record<string, unknown> = {}) {
      calls.push({ name, labels })
    },
    observe() {},
  } as unknown as MetricsPort
  return {
    metrics,
    created: () =>
      calls
        .filter((call) => call.name === 'inbox_entries_created_total')
        .map((call) => call.labels.template_key),
  }
}

function harness(rule: InboxRule, world: World, opts: { chunkSize?: number } = {}) {
  const entries = fakeEntries()
  const outbox = new InMemoryOutbox()
  const metrics = recordingMetrics()
  const handler = new CreateInboxEntries(
    rule,
    new RecipientResolver(makeRecipients(world)),
    entries.repo,
    outbox,
    new InMemoryInbox(),
    new SequentialIds(),
    new FakeClock(new Date('2026-11-03T00:00:00.000Z')),
    metrics.metrics,
    opts.chunkSize,
  )
  return { handler, entries, outbox, metrics }
}

let messageSeq = 0
function envelope(type: string, payload: Record<string, unknown>, id?: string): Envelope {
  messageSeq += 1
  return {
    id: id ?? `msg-${messageSeq}`,
    type,
    source: 'test',
    aggregateId: 'agg',
    occurredAt: '2026-11-03T00:00:00.000Z',
    payload,
    headers: {},
  }
}

function pushMessages(outbox: InMemoryOutbox): PushRequestedPayload[] {
  return outbox.events
    .filter((event) => event.type === NOTIFICATION_EVENTS.pushRequested)
    .map((event) => event.payload as unknown as PushRequestedPayload)
}

function staffMessages(outbox: InMemoryOutbox): StaffInboxCreatedPayload[] {
  return outbox.events
    .filter((event) => event.type === NOTIFICATION_EVENTS.staffInboxCreated)
    .map((event) => event.payload as unknown as StaffInboxCreatedPayload)
}

/** `finance.batch_published.v1` → one `fee.batch_published` plan per charged unit, dedupe by source (DOC-31 §3.2). */
function batchRule(): InboxRule {
  return {
    event: 'finance.batch_published.v1',
    handler: 'notification.inbox_on_finance_batch_published',
    plan(payload) {
      const event = payload as {
        batchId: string
        code: string
        feeMonth: string
        unitIds: string[]
      }
      return event.unitIds.map(
        (unitId): InboxPlan => ({
          templateKey: 'fee.batch_published',
          recipients: { kind: 'unit_members', unitId, capability: 'view_fees' },
          source: { kind: 'batch', id: event.batchId },
          dedupe: 'source',
          params: { batchCode: event.code, feeMonth: event.feeMonth },
        }),
      )
    },
  }
}

/** `finance.batch_due_extended.v1` → dedupe by event, so a second extension is a second entry per member (NT-14). */
function dueExtendedRule(): InboxRule {
  return {
    event: 'finance.batch_due_extended.v1',
    handler: 'notification.inbox_on_finance_batch_due_extended',
    plan(payload) {
      const event = payload as {
        batchId: string
        code: string
        dueDate: string
        unitIds: string[]
      }
      return event.unitIds.map(
        (unitId): InboxPlan => ({
          templateKey: 'fee.batch_due_extended',
          recipients: { kind: 'unit_members', unitId, capability: 'view_fees' },
          source: { kind: 'batch', id: event.batchId },
          dedupe: 'event',
          params: { batchCode: event.code, dueDate: event.dueDate },
        }),
      )
    },
  }
}

/** `finance.payment_posted.v1` → `payment.received` for the unit's `view_fees` members, channel `urgent` (NT-16). */
function paymentPostedRule(): InboxRule {
  return {
    event: 'finance.payment_posted.v1',
    handler: 'notification.inbox_on_finance_payment_posted',
    plan(payload) {
      const event = payload as { paymentId: string; unitId: string }
      return [
        {
          templateKey: 'payment.received',
          recipients: { kind: 'unit_members', unitId: event.unitId, capability: 'view_fees' },
          source: { kind: 'payment', id: event.paymentId },
          dedupe: 'source',
          params: {},
        },
      ]
    },
  }
}

/** `finance.money_unposted.v1` → active Manager and Admin (NT-17). */
function moneyUnpostedRule(): InboxRule {
  return {
    event: 'finance.money_unposted.v1',
    handler: 'notification.inbox_on_finance_money_unposted',
    plan(payload) {
      const event = payload as { kind: 'gateway_event' | 'statement_line'; rowId: string }
      return [
        {
          templateKey: 'finance.money_unposted',
          recipients: { kind: 'staff_roles', roles: ['manager', 'admin'] },
          source: { kind: event.kind, id: event.rowId },
          dedupe: 'source',
          params: {},
        },
      ]
    },
  }
}

/** `vehicles.vehicle_reviewed.v1` → the submitter, kept only while its membership is active (NT-22). */
function residentRule(): InboxRule {
  return {
    event: 'vehicles.vehicle_reviewed.v1',
    handler: 'notification.inbox_on_vehicles_vehicle_reviewed',
    plan(payload) {
      const event = payload as {
        vehicleId: string
        unitId: string
        submittedByAccountId: string | null
      }
      if (event.submittedByAccountId === null) return []
      return [
        {
          templateKey: 'vehicle.approved',
          recipients: {
            kind: 'resident',
            accountId: event.submittedByAccountId,
            unitId: event.unitId,
          },
          source: { kind: 'vehicle', id: event.vehicleId },
          dedupe: 'event',
          params: {},
        },
      ]
    },
  }
}

const batchPayload = (unitIds: string[]): Record<string, unknown> => ({
  buildingId: BUILDING,
  batchId: BATCH,
  code: 'PH-2610-01',
  feeMonth: '2026-10',
  dueDate: '2026-11-10',
  part: 1,
  parts: 1,
  unitIds,
})

describe('CreateInboxEntries (DOC-31 §4.1, NT-10…22)', () => {
  test('NT-10: a published batch tells the owner, family and tenant, not the helper, and pushes once', async () => {
    const { handler, entries, outbox, metrics } = harness(batchRule(), baseWorld())
    await handler.handle(envelope('finance.batch_published.v1', batchPayload([UNIT_1508])))
    expect(entries.rows.map((row) => row.accountId).sort()).toEqual([AN, BINH, FAMILY].sort())
    expect(entries.rows.some((row) => row.accountId === HELPER)).toBe(false)
    const pushes = pushMessages(outbox)
    expect(pushes).toHaveLength(1)
    expect(pushes[0]?.recipients).toHaveLength(3)
    expect(pushes[0]?.route).toBe('/fees')
    expect(pushes[0]?.params).toEqual({ batchCode: 'PH-2610-01', feeMonth: '2026-10' })
    expect(metrics.created()).toEqual([
      'fee.batch_published',
      'fee.batch_published',
      'fee.batch_published',
    ])
  })

  test('NT-11: a redelivery writes nothing; a new envelope with the same payload finds every row taken', async () => {
    const { handler, entries, outbox } = harness(batchRule(), baseWorld())
    const message = envelope('finance.batch_published.v1', batchPayload([UNIT_1508]))
    await handler.handle(message)
    expect(entries.rows).toHaveLength(3)
    expect(pushMessages(outbox)).toHaveLength(1)

    await handler.handle(message)
    expect(entries.rows).toHaveLength(3)
    expect(pushMessages(outbox)).toHaveLength(1)

    await handler.handle(envelope('finance.batch_published.v1', message.payload))
    expect(entries.rows).toHaveLength(3)
    expect(pushMessages(outbox)).toHaveLength(1)
  })

  test('NT-12: one owner of two charged units gets two entries and one push with unitId null', async () => {
    const { handler, entries, outbox } = harness(batchRule(), baseWorld())
    await handler.handle(
      envelope('finance.batch_published.v1', batchPayload([UNIT_1508, UNIT_1509])),
    )
    const an = entries.rows.filter((row) => row.accountId === AN)
    expect(an.map((row) => row.unitId).sort()).toEqual([UNIT_1508, UNIT_1509].sort())
    const pushes = pushMessages(outbox)
    expect(pushes).toHaveLength(1)
    const recipient = pushes[0]?.recipients.find((row) => row.accountId === AN)
    expect(recipient?.unitId).toBeNull()
  })

  test('NT-13: 1,201 units of two members insert 2,402 rows and push in chunks of at most 100', async () => {
    const { world, codes, members } = bigWorld()
    const { handler, entries, outbox } = harness(batchRule(), world)
    await handler.handle(envelope('finance.batch_published.v1', batchPayload(codes)))
    expect(entries.rows).toHaveLength(2_402)
    const pushes = pushMessages(outbox)
    expect(pushes.length).toBeGreaterThan(0)
    expect(pushes.every((message) => message.recipients.length <= 100)).toBe(true)
    const recipients = new Set(
      pushes.flatMap((message) => message.recipients.map((row) => row.accountId)),
    )
    expect(recipients.size).toBe(2_402)
    expect([...recipients].sort()).toEqual([...members].sort())
  })

  test('NT-14: two due-date extensions give two entries per member, dedupe by event', async () => {
    const { handler, entries } = harness(dueExtendedRule(), baseWorld())
    const payload = batchPayload([UNIT_1508])
    await handler.handle(envelope('finance.batch_due_extended.v1', payload))
    await handler.handle(envelope('finance.batch_due_extended.v1', payload))
    expect(entries.rows).toHaveLength(6)
    for (const accountId of [AN, FAMILY, BINH])
      expect(entries.rows.filter((row) => row.accountId === accountId)).toHaveLength(2)
  })

  test('NT-16: a posted payment pushes on the urgent channel', async () => {
    const { handler, entries, outbox } = harness(paymentPostedRule(), baseWorld())
    await handler.handle(
      envelope('finance.payment_posted.v1', {
        buildingId: BUILDING,
        paymentId: PAYMENT,
        unitId: UNIT_1508,
        source: 'online',
        payerAccountId: AN,
        postedAt: '2026-10-19T03:21:44.512Z',
      }),
    )
    expect(entries.rows).toHaveLength(3)
    const pushes = pushMessages(outbox)
    expect(pushes).toHaveLength(1)
    expect(pushes[0]?.templateKey).toBe('payment.received')
    expect(pushes[0]?.channel).toBe('urgent')
  })

  test('NT-17: money_unposted tells the active Manager and Admin, one staff event each', async () => {
    const { handler, entries, outbox } = harness(moneyUnpostedRule(), baseWorld())
    await handler.handle(
      envelope('finance.money_unposted.v1', {
        buildingId: BUILDING,
        kind: 'gateway_event',
        rowId: MONEY_ROW,
        outcome: 'amount_short',
        amount: 2_000_000,
        receivedAt: '2026-10-19T03:25:01.000Z',
      }),
    )
    expect(entries.rows.map((row) => row.accountId).sort()).toEqual([LAM, ADMIN].sort())
    expect(entries.rows.some((row) => row.accountId === DISABLED_MANAGER)).toBe(false)
    expect(entries.rows.every((row) => row.accountKind === 'staff')).toBe(true)
    expect(
      staffMessages(outbox)
        .map((event) => event.staffId)
        .sort(),
    ).toEqual([LAM, ADMIN].sort())
  })

  test('NT-21: a resolver failure on the second unit writes nothing; the retry writes once', async () => {
    const world = baseWorld()
    world.failOn = UNIT_1509
    const { handler, entries, outbox } = harness(batchRule(), world)
    const message = envelope('finance.batch_published.v1', batchPayload([UNIT_1508, UNIT_1509]))
    await expect(handler.handle(message)).rejects.toThrow('listRecipients failed')
    expect(entries.rows).toHaveLength(0)
    expect(outbox.events).toHaveLength(0)

    world.failOn = undefined
    await handler.handle(message)
    expect(entries.rows).toHaveLength(4)
    expect(pushMessages(outbox)).toHaveLength(1)
  })

  test('NT-22: a resident plan whose membership is no longer active writes no entry', async () => {
    const world = baseWorld()
    world.membership.set(`${AN}|${UNIT_1508}`, 'locked')
    const { handler, entries, outbox } = harness(residentRule(), world)
    await handler.handle(
      envelope('vehicles.vehicle_reviewed.v1', {
        buildingId: BUILDING,
        vehicleId: '0192f3c4-5a1e-7000-8000-000000000071',
        unitId: UNIT_1508,
        decision: 'approved',
        rejectCode: null,
        submittedByAccountId: AN,
        reviewedBy: LAM,
      }),
    )
    expect(entries.rows).toHaveLength(0)
    expect(outbox.events).toHaveLength(0)
  })
})
