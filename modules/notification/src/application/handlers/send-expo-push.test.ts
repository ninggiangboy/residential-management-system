import { describe, expect, test } from 'bun:test'
import type { Database } from '@core/db'
import type { Log } from '@core/kernel'
import type { Envelope } from '@core/messaging'
import { FakeClock, InMemoryInbox, SequentialIds } from '@core/testing'
import type { IdentityApi, ResidentAccountDto, StaffDto } from '@mod/identity/contracts'
import { renderNotification } from '@rms/i18n-catalog'
import { recordingMetrics } from '@rms/test-support'
import type { PushRequestedPayload } from '../../contracts'
import type { PushDevice } from '../../domain/device-token'
import type { DeviceTokenRepository } from '../../domain/device-token-repository'
import type { AccountKind } from '../../domain/inbox-entry'
import type { NewPushTicket } from '../../domain/push-ticket'
import type { PushTicketRepository } from '../../domain/push-ticket-repository'
import { DEFAULT_PUSH_CONFIG, type PushConfig } from '../push-config'
import type { ExpoMessage, ExpoReceipt, ExpoTicket, PushSender } from '../push-sender'
import { SendExpoPush } from './send-expo-push'

const BUILDING = '0192f3c4-5a1e-7000-8000-000000000001'
const NOW = new Date('2026-11-03T12:00:00.000Z')
const silent = { info() {}, warn() {}, error() {} } as unknown as Log

type Recipient = PushRequestedPayload['recipients'][number]

function envelope(
  id: string,
  value: PushRequestedPayload,
  occurredAt = NOW.toISOString(),
): Envelope {
  return {
    id,
    type: 'notification.push_requested.v1',
    source: 'notification',
    aggregateId: value.sourceId,
    occurredAt,
    payload: value as unknown as Record<string, unknown>,
    headers: {},
  }
}

function payload(over: Partial<PushRequestedPayload> = {}): PushRequestedPayload {
  return {
    buildingId: BUILDING,
    templateKey: 'fee.batch_published',
    sourceKind: 'batch',
    sourceId: '0192f3c4-5a1e-7000-8000-000000000010',
    params: { batchCode: 'PH-2610-01', feeMonth: '2026-10' },
    channel: 'default',
    route: '/fees',
    entityId: null,
    recipients: [],
    ...over,
  }
}

function resident(id: string, over: Partial<ResidentAccountDto> = {}): ResidentAccountDto {
  return {
    accountId: id,
    phone: '+84900000000',
    displayName: null,
    language: 'vi',
    pushEnabled: true,
    status: 'active',
    lastAppOpenAt: null,
    ...over,
  }
}

function staff(id: string, over: Partial<StaffDto> = {}): StaffDto {
  return {
    staffId: id,
    buildingId: BUILDING,
    fullName: 'Lê Minh',
    role: 'manager',
    status: 'active',
    language: 'vi',
    pushEnabled: true,
    ...over,
  }
}

function device(
  id: string,
  accountId: string,
  accountKind: AccountKind = 'resident',
  over: Partial<PushDevice> = {},
): PushDevice & { accountKind: AccountKind } {
  return {
    id,
    accountId,
    accountKind,
    sessionId: `session-${id}`,
    expoPushToken: `ExponentPushToken[${id}]`,
    platform: 'ios',
    ...over,
  }
}

function fakeTickets() {
  const rows: NewPushTicket[] = []
  const repo = {
    async recordMany(batch: readonly NewPushTicket[]) {
      rows.push(...batch)
      return batch.length
    },
  } as unknown as PushTicketRepository
  const forMessage = (messageId: string) =>
    new Set(rows.filter((row) => row.messageId === messageId).map((row) => row.deviceTokenId))
  return { repo, rows, forMessage }
}

function fakeDevices(tickets: ReturnType<typeof fakeTickets>) {
  const devices: Array<PushDevice & { accountKind: AccountKind }> = []
  const deleted: string[] = []
  const repo = {
    async findForPush(kind: AccountKind, accountIds: readonly string[], messageId: string) {
      const accounts = new Set(accountIds)
      const ticketed = tickets.forMessage(messageId)
      return devices.filter(
        (entry) =>
          entry.accountKind === kind && accounts.has(entry.accountId) && !ticketed.has(entry.id),
      )
    },
    async deleteByIds(ids: readonly string[]) {
      deleted.push(...ids)
      const gone = new Set(ids)
      const remaining = devices.filter((entry) => !gone.has(entry.id))
      const removed = devices.length - remaining.length
      devices.length = 0
      devices.push(...remaining)
      return removed
    },
  } as unknown as DeviceTokenRepository
  return { repo, devices, deleted }
}

function fakeIdentity() {
  const residents = new Map<string, ResidentAccountDto>()
  const staffAccounts = new Map<string, StaffDto>()
  const deadSessions = new Set<string>()
  const api = {
    async getResidentAccounts(ids: readonly string[]) {
      return ids
        .map((id) => residents.get(id))
        .filter((row): row is ResidentAccountDto => row !== undefined)
    },
    async getStaff(ids: readonly string[]) {
      return ids
        .map((id) => staffAccounts.get(id))
        .filter((row): row is StaffDto => row !== undefined)
    },
    async liveSessionIds(ids: readonly string[]) {
      return ids.filter((id) => !deadSessions.has(id))
    },
  } as unknown as Pick<IdentityApi, 'getResidentAccounts' | 'getStaff' | 'liveSessionIds'>
  return { api, residents, staffAccounts, deadSessions }
}

function fakeSender(
  behaviour: {
    failOnCall?: number
    tickets?: (messages: ExpoMessage[], call: number) => ExpoTicket[]
  } = {},
) {
  const calls: ExpoMessage[][] = []
  const sender = {
    async send(messages: ExpoMessage[]) {
      const call = calls.length
      calls.push(messages)
      if (behaviour.failOnCall === call) throw new Error('expo 500')
      if (behaviour.tickets) return behaviour.tickets(messages, call)
      return messages.map(
        (_, index): ExpoTicket => ({ status: 'ok', id: `receipt-${call}-${index}` }),
      )
    },
    async getReceipts() {
      return {} as Record<string, ExpoReceipt>
    },
  } as unknown as PushSender
  return { sender, calls }
}

function build(
  options: {
    failOnCall?: number
    tickets?: (messages: ExpoMessage[], call: number) => ExpoTicket[]
    config?: Partial<PushConfig>
  } = {},
) {
  const clock = new FakeClock(NOW)
  const tickets = fakeTickets()
  const devices = fakeDevices(tickets)
  const identity = fakeIdentity()
  const { sender, calls } = fakeSender({
    failOnCall: options.failOnCall,
    tickets: options.tickets,
  })
  const metrics = recordingMetrics()
  const database = { transaction: (fn: () => Promise<unknown>) => fn() } as unknown as Database
  const handler = new SendExpoPush(
    devices.repo,
    tickets.repo,
    identity.api,
    sender,
    new InMemoryInbox(),
    database,
    clock,
    new SequentialIds(),
    silent,
    metrics,
    { ...DEFAULT_PUSH_CONFIG, ...options.config },
  )
  return { handler, clock, tickets, devices, identity, calls, metrics }
}

describe('SendExpoPush', () => {
  test('NT-50 an account with push off is counted and nothing is sent', async () => {
    const h = build()
    h.identity.residents.set('an', resident('an', { pushEnabled: false }))
    h.devices.devices.push(device('d1', 'an'))
    const recipients: Recipient[] = [{ accountKind: 'resident', accountId: 'an', unitId: null }]
    await h.handler.handle(envelope('m1', payload({ recipients })))
    expect(h.calls).toEqual([])
    expect(h.metrics.count('push_sent_total', { outcome: 'skipped_off' })).toBe(1)
  })

  test('NT-51 a token of a revoked session is deleted and skipped', async () => {
    const h = build()
    h.identity.residents.set('binh', resident('binh'))
    h.devices.devices.push(device('d1', 'binh'))
    h.identity.deadSessions.add('session-d1')
    const recipients: Recipient[] = [{ accountKind: 'resident', accountId: 'binh', unitId: 'u1' }]
    await h.handler.handle(envelope('m2', payload({ recipients })))
    expect(h.calls).toEqual([])
    expect(h.devices.deleted).toEqual(['d1'])
    expect(h.metrics.count('push_sent_total', { outcome: 'skipped_session_dead' })).toBe(1)
  })

  test('NT-52 100 recipients with 250 devices send in three requests of 100, 100, 50', async () => {
    const h = build()
    const recipients: Recipient[] = []
    for (let i = 0; i < 100; i++) {
      const id = `r${i}`
      h.identity.residents.set(id, resident(id))
      recipients.push({ accountKind: 'resident', accountId: id, unitId: null })
    }
    for (let i = 0; i < 250; i++) h.devices.devices.push(device(`d${i}`, `r${i % 100}`))
    await h.handler.handle(envelope('m3', payload({ recipients })))
    expect(h.calls.map((call) => call.length)).toEqual([100, 100, 50])
    expect(h.tickets.rows).toHaveLength(250)
    expect(h.tickets.rows.every((row) => row.status === 'pending')).toBe(true)
  })

  test('NT-53 a send that fails after a partial send; the retry sends only the unticketed devices', async () => {
    const h = build({ failOnCall: 1 })
    const recipients: Recipient[] = []
    for (let i = 0; i < 150; i++) {
      const id = `r${i}`
      h.identity.residents.set(id, resident(id))
      recipients.push({ accountKind: 'resident', accountId: id, unitId: null })
      h.devices.devices.push(device(`d${i}`, id))
    }
    const message = envelope('m4', payload({ recipients }))
    await expect(h.handler.handle(message)).rejects.toThrow()
    expect(h.calls.map((call) => call.length)).toEqual([100, 50])
    expect(h.tickets.rows).toHaveLength(100)
    await h.handler.handle(message)
    expect(h.calls.map((call) => call.length)).toEqual([100, 50, 50])
    expect(h.tickets.rows).toHaveLength(150)
  })

  test('NT-56 one DeviceNotRegistered of 100 deletes that token and records a failed ticket', async () => {
    const h = build({
      tickets: (messages) =>
        messages.map(
          (_, index): ExpoTicket =>
            index === 40
              ? {
                  status: 'error',
                  message: 'not registered',
                  details: { error: 'DeviceNotRegistered' },
                }
              : { status: 'ok', id: `receipt-${index}` },
        ),
    })
    const recipients: Recipient[] = []
    for (let i = 0; i < 100; i++) {
      const id = `r${i}`
      h.identity.residents.set(id, resident(id))
      recipients.push({ accountKind: 'resident', accountId: id, unitId: null })
      h.devices.devices.push(device(`d${i}`, id))
    }
    await h.handler.handle(envelope('m5', payload({ recipients })))
    expect(h.tickets.rows).toHaveLength(100)
    expect(h.tickets.rows.filter((row) => row.status === 'pending')).toHaveLength(99)
    expect(h.tickets.rows.filter((row) => row.status === 'failed')).toHaveLength(1)
    expect(h.devices.deleted).toEqual(['d40'])
    expect(h.metrics.count('push_sent_total', { outcome: 'accepted' })).toBe(99)
    expect(h.metrics.count('push_sent_total', { outcome: 'ticket_error' })).toBe(1)
    expect(
      h.metrics.count('delivery_failed_total', {
        channel: 'push',
        reason: 'device_not_registered',
      }),
    ).toBe(1)
  })

  test('NT-57 a push request 61 minutes old is skipped', async () => {
    const h = build()
    h.identity.residents.set('an', resident('an'))
    h.devices.devices.push(device('d1', 'an'))
    const recipients: Recipient[] = [{ accountKind: 'resident', accountId: 'an', unitId: null }]
    await h.handler.handle(envelope('m6', payload({ recipients }), '2026-11-03T10:59:00.000Z'))
    expect(h.calls).toEqual([])
    expect(h.metrics.count('push_sent_total', { outcome: 'skipped_expired' })).toBe(1)
  })

  test('NT-58 the language is read from the account when the push is sent', async () => {
    const h = build()
    h.identity.residents.set('an', resident('an', { language: 'en' }))
    h.devices.devices.push(device('d1', 'an'))
    // The account switches to Vietnamese before the message goes out.
    h.identity.residents.set('an', resident('an', { language: 'vi' }))
    const recipients: Recipient[] = [{ accountKind: 'resident', accountId: 'an', unitId: null }]
    await h.handler.handle(envelope('m7', payload({ recipients })))
    const expected = renderNotification(
      'fee.batch_published',
      { batchCode: 'PH-2610-01', feeMonth: '2026-10' },
      'vi',
    )
    expect(h.calls[0]?.[0]?.title).toBe(expected.title)
    expect(h.calls[0]?.[0]?.body).toBe(expected.body)
  })

  test('NT-59 a message carries exactly route, unitId and entityId and stays within 4096 bytes', async () => {
    const h = build()
    h.identity.residents.set('an', resident('an'))
    h.devices.devices.push(device('d1', 'an'))
    const recipients: Recipient[] = [{ accountKind: 'resident', accountId: 'an', unitId: 'unit-1' }]
    await h.handler.handle(envelope('m8', payload({ recipients, entityId: 'entity-1' })))
    const message = h.calls[0]?.[0]
    expect(message).toBeDefined()
    expect(message && Object.keys(message.data).sort()).toEqual(['entityId', 'route', 'unitId'])
    expect(message?.data.unitId).toBe('unit-1')
    expect(message?.data.entityId).toBe('entity-1')
    expect(new TextEncoder().encode(JSON.stringify(message)).length).toBeLessThanOrEqual(4096)
  })

  test('NT-61 a 5,000-recipient run sends every message', async () => {
    const h = build()
    const recipients: Recipient[] = []
    for (let i = 0; i < 5000; i++) {
      const id = `r${i}`
      h.identity.residents.set(id, resident(id))
      recipients.push({ accountKind: 'resident', accountId: id, unitId: null })
      h.devices.devices.push(device(`d${i}`, id))
    }
    await h.handler.handle(envelope('m9', payload({ recipients })))
    expect(h.calls).toHaveLength(50)
    expect(h.tickets.rows).toHaveLength(5000)
  })
})
