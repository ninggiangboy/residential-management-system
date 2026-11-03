import { describe, expect, test } from 'bun:test'
import type { Log } from '@core/kernel'
import type { Envelope } from '@core/messaging'
import { InMemoryInbox } from '@core/testing'
import type { DeviceTokenRepository } from '../../domain/device-token-repository'
import type { InboxAccount, InboxEntryRepository } from '../../domain/inbox-entry-repository'
import { DropDeviceTokenOnSessionRevokedHandler } from './drop-device-token-on-session-revoked'
import { DropTokensOnAccountDeletionHandler } from './drop-tokens-on-account-deletion'
import { MarkReadOnNoticeReadHandler } from './mark-read-on-notice-read'

const silent = { info() {}, warn() {}, error() {}, debug() {} } as unknown as Log

const envelope = (id: string, type: string, payload: Record<string, unknown>): Envelope => ({
  id,
  type,
  source: 'test',
  aggregateId: 'agg',
  occurredAt: '2026-11-03T00:00:00.000Z',
  payload,
  headers: {} as Envelope['headers'],
})

/** A device list that deletes by the same keys as the repository and counts what it removed. */
function fakeDevices(rows: Array<{ session: string; kind: string; account: string }>) {
  const live = [...rows]
  const repo = {
    async deleteBySession(session: string, kind: string, account: string) {
      const before = live.length
      for (let i = live.length - 1; i >= 0; i--) {
        const row = live[i]
        if (row && row.session === session && row.kind === kind && row.account === account)
          live.splice(i, 1)
      }
      return before - live.length
    },
    async deleteByAccount(kind: string, account: string) {
      const before = live.length
      for (let i = live.length - 1; i >= 0; i--) {
        const row = live[i]
        if (row && row.kind === kind && row.account === account) live.splice(i, 1)
      }
      return before - live.length
    },
  } as unknown as DeviceTokenRepository
  return { repo, live }
}

describe('NT-44: identity.session_revoked.v1 drops the token of that session', () => {
  test('the token is deleted, a second delivery deletes nothing', async () => {
    const { repo, live } = fakeDevices([
      { session: 's1', kind: 'resident', account: 'an' },
      { session: 's2', kind: 'resident', account: 'an' },
    ])
    const handler = new DropDeviceTokenOnSessionRevokedHandler(repo, new InMemoryInbox(), silent)
    const message = envelope('m1', 'identity.session_revoked.v1', {
      buildingId: null,
      accountKind: 'resident',
      accountId: 'an',
      sessionId: 's1',
      reason: 'sign_out',
    })
    await handler.handle(message)
    expect(live.map((row) => row.session)).toEqual(['s2'])
    await handler.handle(message)
    expect(live).toHaveLength(1)
  })

  test('another account with the same session id keeps its token', async () => {
    const { repo, live } = fakeDevices([{ session: 's1', kind: 'staff', account: 'lm' }])
    const handler = new DropDeviceTokenOnSessionRevokedHandler(repo, new InMemoryInbox(), silent)
    await handler.handle(
      envelope('m2', 'identity.session_revoked.v1', {
        accountKind: 'resident',
        accountId: 'an',
        sessionId: 's1',
      }),
    )
    expect(live).toHaveLength(1)
  })
})

describe('NT-45: identity.account_deletion_executed.v1 drops every token of the account', () => {
  test('both devices go, and a repeat is a no-op', async () => {
    const { repo, live } = fakeDevices([
      { session: 's1', kind: 'resident', account: 'an' },
      { session: 's2', kind: 'resident', account: 'an' },
      { session: 's3', kind: 'resident', account: 'binh' },
    ])
    const handler = new DropTokensOnAccountDeletionHandler(repo, new InMemoryInbox(), silent)
    const message = envelope('m3', 'identity.account_deletion_executed.v1', {
      buildingId: null,
      accountId: 'an',
      executedAt: '2026-11-03T00:00:00.000Z',
    })
    await handler.handle(message)
    await handler.handle(message)
    expect(live.map((row) => row.account)).toEqual(['binh'])
  })
})

describe('NT-37: notices.notice_read.v1 marks the notice entry read once', () => {
  test('the second delivery of the same envelope changes nothing', async () => {
    const calls: Array<{ account: InboxAccount; noticeId: string }> = []
    const entries = {
      async markNoticeRead(_scope: unknown, account: InboxAccount, noticeId: string) {
        calls.push({ account, noticeId })
        return 1
      },
    } as unknown as InboxEntryRepository
    const handler = new MarkReadOnNoticeReadHandler(entries, new InMemoryInbox())
    const message = envelope('m4', 'notices.notice_read.v1', {
      buildingId: 'b1',
      noticeId: 'n1',
      accountKind: 'resident',
      accountId: 'an',
      readAt: '2026-11-03T00:00:00.000Z',
    })
    await handler.handle(message)
    await handler.handle(message)
    expect(calls).toEqual([{ account: { kind: 'resident', id: 'an' }, noticeId: 'n1' }])
  })
})
