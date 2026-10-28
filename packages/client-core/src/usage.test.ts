import { describe, expect, test } from 'bun:test'
import {
  createUsageTracker,
  USAGE_DEFAULT_ENABLED,
  type UsageAnswer,
  type UsageBatchBody,
  type UsageTrackerOptions,
} from './usage'

const MIN = 60_000

/** A tracker on a fake monotonic clock, a fake network and a fake timer: no real time passes in these tests. */
function harness(
  over: Partial<UsageTrackerOptions> & { answer?: () => Promise<UsageAnswer> } = {},
) {
  let clock = 1_000
  let ids = 0
  let stored: boolean | null = null
  const sent: UsageBatchBody[] = []
  const timers: Array<{ at: number; run: () => void; live: boolean }> = []
  const tracker = createUsageTracker({
    app: 'resident',
    platform: 'ios',
    appVersion: '1.0.3',
    now: () => clock,
    newId: () => `session-${++ids}`,
    store: { read: () => stored, write: (value) => (stored = value) },
    send: async (body) => {
      sent.push(structuredClone(body))
      return over.answer ? over.answer() : { stop: false }
    },
    schedule: (run, ms) => {
      const timer = { at: clock + ms, run, live: true }
      timers.push(timer)
      return () => {
        timer.live = false
      }
    },
    ...over,
  })
  return {
    tracker,
    sent,
    stored: () => stored,
    advance(ms: number) {
      clock += ms
      for (const timer of timers)
        if (timer.live && timer.at <= clock) {
          timer.live = false
          timer.run()
        }
    },
    liveTimers: () => timers.filter((timer) => timer.live).length,
  }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** The tracker signed in and in the foreground, the first stretch's `app_open` already sent away. */
async function ready(over: Parameters<typeof harness>[0] = {}) {
  const h = harness(over)
  h.tracker.setSignedIn(true)
  h.tracker.foreground(true)
  await h.tracker.flush()
  h.sent.length = 0
  return h
}

describe('UA-21 the switch', () => {
  test('off: nothing is queued, the queue is cleared, no request is made, and the choice is stored', async () => {
    const h = harness()
    h.tracker.setSignedIn(true)
    h.tracker.foreground(true)
    h.tracker.screen('Main')
    expect(h.tracker.queued()).toBe(2)
    h.tracker.setEnabled(false)
    expect(h.tracker.queued()).toBe(0)
    h.tracker.screen('Account')
    h.tracker.tap('Account.push')
    h.tracker.foreground(false)
    await h.tracker.flush()
    expect(h.tracker.queued()).toBe(0)
    expect(h.sent).toEqual([])
    expect(h.stored()).toBe(false)
  })

  test('UA-26 the stored choice wins after a restart; with none stored the default is on', () => {
    expect(USAGE_DEFAULT_ENABLED).toBe(true)
    expect(harness().tracker.isEnabled()).toBe(true)
    expect(harness({ store: { read: () => false, write: () => {} } }).tracker.isEnabled()).toBe(
      false,
    )
    expect(
      harness({
        store: {
          read: () => {
            throw new Error('keychain locked')
          },
          write: () => {},
        },
      }).tracker.isEnabled(),
    ).toBe(true)
  })

  test('a store that cannot write does not stop the switch', () => {
    const h = harness({
      store: {
        read: () => null,
        write: () => {
          throw new Error('full')
        },
      },
    })
    h.tracker.setEnabled(false)
    expect(h.tracker.isEnabled()).toBe(false)
  })

  test('listeners hear a change of the switch and only a change', () => {
    const h = harness()
    let heard = 0
    const stop = h.tracker.subscribe(() => heard++)
    h.tracker.setEnabled(false)
    h.tracker.setEnabled(false)
    h.tracker.setEnabled(true)
    stop()
    h.tracker.setEnabled(false)
    expect(heard).toBe(2)
  })
})

describe('UA-22 the session', () => {
  test('the same id for 29 minutes in the background, a new one after 31', async () => {
    const h = await ready()
    h.tracker.screen('Main')
    h.tracker.foreground(false)
    await settle()
    h.advance(29 * MIN)
    h.tracker.foreground(true)
    await h.tracker.flush()
    h.tracker.foreground(false)
    await settle()
    h.advance(31 * MIN)
    h.tracker.foreground(true)
    await h.tracker.flush()
    const ids = h.sent.map((body) => body.sessionId)
    expect(ids).toHaveLength(4)
    expect(new Set(ids.slice(0, 3)).size).toBe(1)
    expect(ids[3]).not.toBe(ids[2])
    expect(h.sent[3]?.events[0]).toMatchObject({ event: 'app_open', name: 'Resume' })
  })

  test('the id is made in memory and sent in the body only (the tracker takes no storage for it)', async () => {
    const written: string[] = []
    const h = harness({
      store: { read: () => null, write: (value) => written.push(String(value)) },
    })
    h.tracker.setSignedIn(true)
    h.tracker.foreground(true)
    await h.tracker.flush()
    expect(written).toEqual([])
    expect(h.sent[0]?.sessionId).toBe('session-1')
  })
})

describe('UA-23 failures', () => {
  test('a network error keeps the events for the next batch; those over an hour old are dropped; the queue holds at most 100', async () => {
    let down = true
    const h = harness({
      answer: async () => {
        if (down) throw new Error('offline')
        return { stop: false }
      },
    })
    h.tracker.setSignedIn(true)
    h.tracker.foreground(true)
    h.tracker.screen('Main')
    await h.tracker.flush()
    expect(h.tracker.queued()).toBe(2)
    h.advance(61 * MIN)
    h.tracker.tap('Account.push')
    down = false
    await h.tracker.flush()
    // The two old events were over an hour old and are gone; the new tap went.
    expect(h.sent.at(-1)?.events.map((event) => event.name)).toEqual(['Account.push'])
    expect(h.tracker.queued()).toBe(0)

    down = true
    for (let i = 0; i < 250; i++) {
      h.advance(1100)
      h.tracker.tap('Account.push')
    }
    expect(h.tracker.queued()).toBeLessThanOrEqual(100)
  })

  test('any answer drops the batch: 429 and 503 are not retried and nothing is thrown', async () => {
    const h = await ready({ answer: async () => ({ stop: false }) })
    h.tracker.tap('Account.push')
    await h.tracker.flush()
    expect(h.sent).toHaveLength(1)
    expect(h.tracker.queued()).toBe(0)
    await h.tracker.flush()
    expect(h.sent).toHaveLength(1)
  })

  test('a sender that throws synchronously-looking errors never reaches the caller', async () => {
    const h = harness({
      answer: () => {
        throw new Error('boom')
      },
    })
    h.tracker.setSignedIn(true)
    h.tracker.foreground(true)
    await expect(h.tracker.flush()).resolves.toBeUndefined()
  })
})

describe('UA-24 sign-out', () => {
  test('the queue is empty after it, and nothing of the first account goes with the second token', async () => {
    const h = harness()
    h.tracker.setSignedIn(true)
    h.tracker.foreground(true)
    for (let i = 0; i < 5; i++) h.tracker.tap('Account.push')
    h.tracker.setSignedIn(false)
    expect(h.tracker.queued()).toBe(0)
    h.tracker.setSignedIn(true)
    await h.tracker.flush()
    expect(h.sent).toHaveLength(1)
    // The first stretch of the process was `Launch`; the next sign-in opens a later one, in a session of its own.
    expect(h.sent[0]?.events.map((event) => event.name)).toEqual(['Resume'])
    expect(h.sent[0]?.sessionId).toBe('session-2')
  })
})

describe('UA-25 noise and names', () => {
  test('the same screen twice within a second is one event; a tap is never merged', async () => {
    const h = await ready()
    h.tracker.screen('Account')
    h.advance(400)
    h.tracker.screen('Account')
    h.advance(700)
    h.tracker.screen('Account')
    h.tracker.tap('Account.push')
    h.tracker.tap('Account.push')
    await h.tracker.flush()
    expect(h.sent[0]?.events.map((event) => `${event.event}:${event.name}`)).toEqual([
      'screen_view:Account',
      'screen_view:Account',
      'tap:Account.push',
      'tap:Account.push',
    ])
  })

  test('nothing is queued while nobody is signed in', async () => {
    const h = harness()
    h.tracker.foreground(true)
    h.tracker.screen('Main')
    h.tracker.tap('Account.push')
    expect(h.tracker.queued()).toBe(0)
  })
})

describe('UA-30 the server tells the app to stop', () => {
  test('the queue is cleared, nothing is queued or sent for the launch, and the next launch sends again', async () => {
    let stop = false
    const h = await ready({ answer: async () => ({ stop }) })
    stop = true
    h.tracker.screen('Main')
    await h.tracker.flush()
    expect(h.sent).toHaveLength(1)
    expect(h.tracker.queued()).toBe(0)
    h.tracker.tap('Account.push')
    h.tracker.screen('Account')
    h.tracker.foreground(false)
    h.tracker.foreground(true)
    await h.tracker.flush()
    expect(h.tracker.queued()).toBe(0)
    expect(h.sent).toHaveLength(1)

    const next = harness()
    next.tracker.setSignedIn(true)
    next.tracker.foreground(true)
    await next.tracker.flush()
    expect(next.sent).toHaveLength(1)
  })
})

describe('UA-31 batching', () => {
  test('30 events in 4 minutes make no request; the background makes one request with all of them', async () => {
    const h = await ready()
    for (let i = 0; i < 30; i++) {
      h.advance(8_000)
      h.tracker.tap('Account.push')
    }
    expect(h.sent).toHaveLength(0)
    h.tracker.foreground(false)
    await settle()
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]?.events).toHaveLength(31)
    expect(h.sent[0]?.events.at(-1)).toMatchObject({ event: 'app_close', name: 'Background' })
  })

  test('the 50th queued event sends at once', async () => {
    const h = await ready()
    for (let i = 0; i < 49; i++) h.tracker.tap('Account.push')
    expect(h.sent).toHaveLength(0)
    h.tracker.tap('Account.push')
    await settle()
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]?.events).toHaveLength(50)
  })

  test('5 minutes after the first queued event the batch goes, without any other trigger', async () => {
    const h = await ready()
    h.tracker.tap('Account.push')
    h.advance(4 * MIN)
    await settle()
    expect(h.sent).toHaveLength(0)
    h.advance(MIN)
    await settle()
    expect(h.sent).toHaveLength(1)
    expect(h.liveTimers()).toBe(0)
  })

  test('one request at a time: events queued while one is in flight go in the next', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let gated = false
    const h = await ready({
      answer: async () => {
        if (gated) await gate
        return { stop: false }
      },
    })
    gated = true
    h.tracker.tap('Account.push')
    const first = h.tracker.flush()
    h.tracker.tap('Account.language')
    await h.tracker.flush()
    expect(h.sent).toHaveLength(1)
    release()
    await first
    await h.tracker.flush()
    expect(h.sent).toHaveLength(2)
    expect(h.sent[1]?.events.map((event) => event.name)).toEqual(['Account.language'])
  })

  test('ageMs is the monotonic time since the event, as an integer', async () => {
    const h = await ready()
    h.tracker.tap('Account.push')
    h.advance(1_500)
    h.tracker.screen('Main')
    h.advance(250)
    await h.tracker.flush()
    expect(h.sent[0]?.events.map((event) => event.ageMs)).toEqual([1_750, 250])
  })

  test('the resident app sends nothing while no unit is chosen, and keeps the events', async () => {
    let unit: string | null = null
    const h = harness({ canSend: () => unit !== null })
    h.tracker.setSignedIn(true)
    h.tracker.foreground(true)
    await h.tracker.flush()
    expect(h.sent).toHaveLength(0)
    expect(h.tracker.queued()).toBe(1)
    unit = 'unit-1'
    await h.tracker.flush()
    expect(h.sent).toHaveLength(1)
  })

  test('events of two sessions never share a batch', async () => {
    const h = harness({
      answer: async () => {
        throw new Error('offline')
      },
    })
    h.tracker.setSignedIn(true)
    h.tracker.foreground(true)
    h.tracker.foreground(false)
    await settle()
    h.advance(31 * MIN)
    await settle()
    h.sent.length = 0
    h.tracker.foreground(true)
    await settle()
    expect(h.sent[0]?.sessionId).toBe('session-1')
    expect(h.sent[0]?.events.map((event) => event.name)).toEqual(['Launch', 'Background'])
  })
})

describe('UA-35 opening, closing and the time of use', () => {
  test('active then background 61 s later queues app_open Launch and app_close 61; inactive is not a call', async () => {
    const h = harness()
    h.tracker.setSignedIn(true)
    h.tracker.foreground(true)
    h.advance(61_000)
    h.tracker.foreground(false)
    await settle()
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0]?.events).toEqual([
      { event: 'app_open', name: 'Launch', ageMs: 61_000 },
      { event: 'app_close', name: 'Background', ageMs: 0, durationSec: 61 },
    ])
  })

  test('a return after 31 minutes is Resume of a new session', async () => {
    const h = await ready()
    h.tracker.foreground(false)
    await settle()
    h.sent.length = 0
    h.advance(31 * MIN)
    h.tracker.foreground(true)
    await h.tracker.flush()
    expect(h.sent[0]?.events[0]).toMatchObject({ event: 'app_open', name: 'Resume' })
    expect(h.sent[0]?.sessionId).toBe('session-2')
  })

  test('the web hidden then pagehide queues one close', async () => {
    const h = harness()
    h.tracker.setSignedIn(true)
    h.tracker.foreground(true)
    h.advance(10_000)
    h.tracker.foreground(false)
    h.tracker.foreground(false)
    await settle()
    expect(
      h.sent.flatMap((body) => body.events).filter((e) => e.event === 'app_close'),
    ).toHaveLength(1)
  })

  test('a stretch of 30 hours is cut to 86,400 seconds', async () => {
    const h = await ready()
    h.advance(30 * 60 * MIN)
    h.tracker.foreground(false)
    await settle()
    expect(h.sent[0]?.events.at(-1)).toMatchObject({ event: 'app_close', durationSec: 86_400 })
  })

  test('signing out inside a stretch queues no close, and the next sign-in opens a new stretch', async () => {
    const h = await ready()
    h.advance(5_000)
    h.tracker.setSignedIn(false)
    h.tracker.foreground(false)
    await settle()
    expect(h.sent).toEqual([])
    h.tracker.foreground(true)
    h.tracker.setSignedIn(true)
    await h.tracker.flush()
    expect(h.sent[0]?.events.map((event) => `${event.event}:${event.name}`)).toEqual([
      'app_open:Resume',
    ])
  })

  test('the switch off queues no open and no close', async () => {
    const h = await ready()
    h.tracker.setEnabled(false)
    h.tracker.foreground(false)
    h.tracker.foreground(true)
    h.tracker.foreground(false)
    await settle()
    expect(h.sent).toEqual([])
  })

  test('the wall clock is never read', async () => {
    const real = Date.now
    Date.now = () => {
      throw new Error('the tracker read the wall clock')
    }
    try {
      const h = await ready()
      h.tracker.screen('Main')
      h.tracker.foreground(false)
      await settle()
      expect(h.sent.length).toBeGreaterThan(0)
    } finally {
      Date.now = real
    }
  })
})
