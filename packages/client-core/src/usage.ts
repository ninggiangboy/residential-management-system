import {
  USAGE_AGE_MAX_MS,
  USAGE_BATCH_MAX_EVENTS,
  USAGE_DURATION_MAX_SEC,
  type UsageApp,
  type UsageEventKind,
  type UsagePlatform,
  type UsageScreen,
  type UsageTarget,
} from '@rms/shared-types'

/**
 * The tracker of the usage record (DR-279, DOC-104 §5): the pure part, shared by the two Expo apps and the web CMS. It holds the
 * queue, the session, the batching and the foreground stretch, and has no I/O of its own: the clock (a monotonic one), the id maker,
 * the timer, the switch's storage and the sender are passed in, so a test needs no timer and no network. Every call returns at once,
 * never throws and never awaits the network; nothing the tracker does can reach the user.
 */

/** The default of the switch (DOC-104 §5.4, DR-279 (5)). Baked into the app: counsel's answer (DR-279 (11)) may turn it off, in a release. */
export const USAGE_DEFAULT_ENABLED = true

/** The session is renewed when the app comes back after more than this long in the background (DOC-104 §5.2). */
export const USAGE_SESSION_RENEW_MS = 30 * 60_000
/** The queue never holds more than this; the oldest event is dropped beyond it (DOC-104 §5.3). */
export const USAGE_QUEUE_MAX = 100
/** A batch is sent at once when this many events are queued, and at the latest this long after the first queued event. */
export const USAGE_FLUSH_AT = USAGE_BATCH_MAX_EVENTS
export const USAGE_FLUSH_AFTER_MS = 5 * 60_000
/** A `screen_view` of the same id within this long of the previous one is merged (DOC-104 §5.5). */
export const USAGE_SCREEN_MERGE_MS = 1000

export interface UsageEventBody {
  event: UsageEventKind
  name: string
  ageMs: number
  /** `app_close` only. */
  durationSec?: number
}

/** The body of E-173 and E-174 (DOC-104 §6.2). */
export interface UsageBatchBody {
  app: UsageApp
  appVersion: string
  platform: UsagePlatform
  sessionId: string
  events: UsageEventBody[]
}

/**
 * What a sender resolves with once the server has answered, whatever the status: the batch is dropped. `stop` is true when the answer
 * carries `X-Usage-Enabled: false`. A sender rejects only when no answer arrived (a network error), and then the events stay queued.
 */
export interface UsageAnswer {
  stop: boolean
}

export interface UsageTrackerOptions {
  app: UsageApp
  platform: UsagePlatform
  appVersion: string
  send: (body: UsageBatchBody) => Promise<UsageAnswer>
  /** Whether a batch can be sent now; the resident app needs a unit chosen (DOC-104 §5.3). The events stay queued while it is false. */
  canSend?: () => boolean
  /** The device storage of the switch: `read` gives `null` when nothing is stored. Both are called inside a `try`. */
  store: { read: () => boolean | null; write: (enabled: boolean) => void }
  /** A monotonic clock in milliseconds (`performance.now()`); the wall clock is never read (DOC-104 §5.6). */
  now: () => number
  /** A UUID v4 made with the platform's secure random source (DOC-104 §5.2). */
  newId: () => string
  /** Starts a timer and returns its cancel; without it the 5-minute rule is checked when an event is queued. */
  schedule?: (run: () => void, ms: number) => () => void
}

interface Queued {
  event: UsageEventKind
  name: string
  at: number
  sessionId: string
  durationSec?: number
}

const clampSeconds = (ms: number) =>
  Math.min(USAGE_DURATION_MAX_SEC, Math.max(0, Math.floor(ms / 1000)))

export function createUsageTracker(options: UsageTrackerOptions) {
  const { now } = options
  const safe = <T>(read: () => T, fallback: T): T => {
    try {
      return read()
    } catch {
      return fallback
    }
  }

  let enabled = safe(options.store.read, null) ?? USAGE_DEFAULT_ENABLED
  /** The server said stop (`X-Usage-Enabled: false`): nothing is queued or sent for the rest of this launch (DOC-104 §5.4). */
  let stopped = false
  let signedIn = false
  let visible = false
  let launched = false
  let stretchStart: number | null = null
  let leftAt: number | null = null
  let sessionId = options.newId()
  let queue: Queued[] = []
  let cancelTimer: (() => void) | null = null
  let inFlight = false
  let lastScreen: { name: string; at: number } | null = null
  const listeners = new Set<() => void>()

  const active = () => enabled && !stopped && signedIn

  function renewSession() {
    sessionId = options.newId()
    lastScreen = null
  }

  function disarm() {
    cancelTimer?.()
    cancelTimer = null
  }

  function clearQueue() {
    queue = []
    disarm()
  }

  function arm() {
    if (cancelTimer || !options.schedule || queue.length === 0) return
    const wait = Math.max(0, USAGE_FLUSH_AFTER_MS - (now() - (queue[0] as Queued).at))
    cancelTimer = options.schedule(() => {
      cancelTimer = null
      void flush()
    }, wait)
  }

  function push(event: UsageEventKind, name: string, durationSec?: number) {
    if (!active()) return
    const at = now()
    if (queue.length >= USAGE_QUEUE_MAX) queue.shift()
    queue.push({
      event,
      name,
      at,
      sessionId,
      ...(durationSec === undefined ? {} : { durationSec }),
    })
    arm()
    if (queue.length >= USAGE_FLUSH_AT || at - (queue[0] as Queued).at >= USAGE_FLUSH_AFTER_MS)
      void flush()
  }

  function openStretch() {
    if (!active() || !visible || stretchStart !== null) return
    if (leftAt !== null && now() - leftAt > USAGE_SESSION_RENEW_MS) renewSession()
    stretchStart = now()
    push('app_open', launched ? 'Resume' : 'Launch')
    launched = true
  }

  function closeStretch() {
    if (stretchStart === null) return
    const seconds = clampSeconds(now() - stretchStart)
    stretchStart = null
    push('app_close', 'Background', seconds)
  }

  /** The events of the first queued event's session, at most one request's worth (DOC-104 §5.3). */
  function nextBatch(): Queued[] {
    const first = queue[0]
    if (!first) return []
    const batch: Queued[] = []
    for (const item of queue) {
      if (item.sessionId !== first.sessionId || batch.length >= USAGE_FLUSH_AT) break
      batch.push(item)
    }
    return batch
  }

  async function flush(): Promise<void> {
    if (inFlight || !active()) return
    if (options.canSend && !safe(options.canSend, false)) return
    const sentAt = now()
    // The server refuses an age over one hour, so an older event is dropped here (DOC-104 §5.3).
    queue = queue.filter((item) => sentAt - item.at <= USAGE_AGE_MAX_MS)
    const batch = nextBatch()
    if (batch.length === 0) return disarm()
    const body: UsageBatchBody = {
      app: options.app,
      appVersion: options.appVersion,
      platform: options.platform,
      sessionId: (batch[0] as Queued).sessionId,
      events: batch.map((item) => ({
        event: item.event,
        name: item.name,
        ageMs: Math.min(USAGE_AGE_MAX_MS, Math.max(0, Math.round(sentAt - item.at))),
        ...(item.durationSec === undefined ? {} : { durationSec: item.durationSec }),
      })),
    }
    inFlight = true
    let answered = false
    try {
      const answer = await options.send(body)
      answered = true
      // Any answer ends the batch: no retry loop, no message to the person.
      const sent = new Set(batch)
      queue = queue.filter((item) => !sent.has(item))
      if (answer.stop) {
        stopped = true
        clearQueue()
      }
    } catch {
      // No answer: the events stay queued and go with the next batch.
    } finally {
      inFlight = false
    }
    disarm()
    arm()
    if (answered && active() && nextBatch().length > 0 && queue.length >= USAGE_FLUSH_AT)
      void flush()
  }

  const notify = () => {
    for (const listener of listeners) listener()
  }

  return {
    /** A screen of DOC-56 gained focus (DOC-104 §5.1). The route-to-screen map of each app gives the id; a route not in it is not tracked. */
    screen(id: UsageScreen): void {
      if (!active()) return
      const at = now()
      if (lastScreen && lastScreen.name === id && at - lastScreen.at < USAGE_SCREEN_MERGE_MS) return
      lastScreen = { name: id, at }
      push('screen_view', id)
    },

    /** The press that starts the action of a listed control. The tap is never merged: ten presses are ten events. */
    tap(target: UsageTarget): void {
      push('tap', target)
    },

    /**
     * The app came to the foreground (`true`) or left it (`false`). Mobile: `AppState` `active` and `background`; `inactive` calls
     * nothing. Web: `visibilitychange` and `pagehide`, which may both say `false`: the second is a no-op (DOC-104 §5.6).
     */
    foreground(on: boolean): void {
      if (on) {
        if (visible) return
        visible = true
        openStretch()
        return
      }
      if (!visible) return
      visible = false
      leftAt = now()
      if (active()) closeStretch()
      stretchStart = null
      void flush()
    },

    /**
     * A signed-in user exists (`true`) or not (`false`). Signing out clears the queue before the token is dropped, so events of one
     * account never go out with the token of the next; the stretch in progress is not recorded (DOC-104 §5.3, §5.6).
     */
    setSignedIn(on: boolean): void {
      if (on === signedIn) return
      signedIn = on
      if (!on) {
        clearQueue()
        stretchStart = null
        leftAt = null
        renewSession()
        return
      }
      openStretch()
    },

    /** The switch (DOC-104 §5.4): stored on the device; off clears the queue at once, on starts a new session. */
    setEnabled(on: boolean): void {
      if (on === enabled) return
      enabled = on
      safe(() => options.store.write(on), undefined)
      if (!on) {
        clearQueue()
        stretchStart = null
      } else {
        renewSession()
        openStretch()
      }
      notify()
    },

    isEnabled: () => enabled,

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /** Sends what is queued now, if a request is not already in flight. The tracker calls it by itself; a test calls it. */
    flush,

    /** For tests: how many events wait. */
    queued: () => queue.length,
  }
}

export type UsageTracker = ReturnType<typeof createUsageTracker>
