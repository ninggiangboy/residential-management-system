import { describe, expect, test } from 'bun:test'
import { batchIssues, splitByLists, type UsageBatch } from './usage-batch'

const SESSION = '0192f3c4-9d02-4000-8000-00000000a001'

const batch = (events: UsageBatch['events'], over: Partial<UsageBatch> = {}): UsageBatch => ({
  app: 'resident',
  appVersion: '1.0.3',
  platform: 'ios',
  sessionId: SESSION,
  events,
  ...over,
})

describe('batchIssues (DOC-104 §6.2)', () => {
  test('UA-32 app_close needs durationSec and no other event may carry it', () => {
    const ok = batch([
      { event: 'app_open', name: 'Launch', ageMs: 100 },
      { event: 'app_close', name: 'Background', ageMs: 0, durationSec: 61 },
    ])
    expect(batchIssues(ok)).toEqual([])
    expect(
      batchIssues(batch([{ event: 'app_close', name: 'Background', ageMs: 0 }])).map((i) => i.path),
    ).toEqual(['events.0.durationSec'])
    expect(
      batchIssues(
        batch([{ event: 'tap', name: 'Account.language', ageMs: 0, durationSec: 5 }]),
      ).map((i) => i.path),
    ).toEqual(['events.0.durationSec'])
  })

  test('the session id is a UUID v4', () => {
    const events = [{ event: 'screen_view', name: 'Main', ageMs: 0 }] as const
    expect(
      batchIssues(batch(events, { sessionId: '0192f3c4-9d02-7000-8000-00000000a001' })),
    ).toEqual([{ path: 'sessionId', code: 'format', message: 'must be a UUID v4' }])
    expect(batchIssues(batch(events, { sessionId: crypto.randomUUID() }))).toEqual([])
  })
})

describe('splitByLists (DOC-104 §6.1 step 8)', () => {
  const ids = () => {
    let n = 0
    return () => `id-${++n}`
  }

  test('UA-03, UA-13, UA-14 a name outside the lists is dropped and counted, the rest is kept', () => {
    const { kept, dropped } = splitByLists(
      [
        { event: 'screen_view', name: 'Account', ageMs: 5 },
        { event: 'screen_view', name: 'Nowhere', ageMs: 5 },
        { event: 'screen_view', name: 'Login', ageMs: 5 },
        { event: 'screen_view', name: 'OTP', ageMs: 5 },
        { event: 'screen_view', name: 'Terms', ageMs: 5 },
        { event: 'screen_view', name: 'Unit-Pick', ageMs: 5 },
        { event: 'tap', name: 'Nowhere.save', ageMs: 5 },
        { event: 'tap', name: 'Account.unlisted', ageMs: 5 },
        { event: 'tap', name: 'Account.language', ageMs: 5 },
      ],
      ids(),
    )
    expect(kept.map((row) => `${row.event}:${row.name}`)).toEqual([
      'screen_view:Account',
      'tap:Account.language',
    ])
    expect(dropped).toBe(7)
  })

  test('UA-04 a name with a query string, a path or a trailing dot is dropped', () => {
    const { kept, dropped } = splitByLists(
      ['Fees?unit=1', '/fees', 'Fees.'].map((name) => ({
        event: 'screen_view' as const,
        name,
        ageMs: 0,
      })),
      ids(),
    )
    expect(kept).toEqual([])
    expect(dropped).toBe(3)
  })

  test('UA-32 app_open is Launch or Resume, app_close is Background, and only app_close keeps a duration', () => {
    const { kept, dropped } = splitByLists(
      [
        { event: 'app_open', name: 'Launch', ageMs: 9 },
        { event: 'app_open', name: 'Resume', ageMs: 8 },
        { event: 'app_open', name: 'Background', ageMs: 7 },
        { event: 'app_close', name: 'Background', ageMs: 0, durationSec: 61 },
        { event: 'app_close', name: 'Launch', ageMs: 0, durationSec: 61 },
      ],
      ids(),
    )
    expect(kept.map((row) => [row.event, row.name, row.durationS])).toEqual([
      ['app_open', 'Launch', null],
      ['app_open', 'Resume', null],
      ['app_close', 'Background', 61],
    ])
    expect(dropped).toBe(2)
  })
})
