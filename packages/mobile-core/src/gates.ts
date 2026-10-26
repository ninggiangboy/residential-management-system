/** Where the fetcher hands over to a screen and waits (DOC-55 §4.1, §6). Each gate is a tiny external store. */
function store<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next: T) {
      value = next
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * `terms_required` (403): the fetcher awaits `request()` and replays the interrupted call once. Several requests share one
 * promise, so one `Terms-Update` screen is shown, never two (UIRA-29). The screen calls `resolve()` after E-17 succeeds.
 */
export function createTermsGate() {
  const open = store(false)
  let pending: { promise: Promise<void>; resolve: () => void } | null = null
  return {
    isOpen: open.get,
    subscribe: open.subscribe,
    request(): Promise<void> {
      if (!pending) {
        let resolve!: () => void
        const promise = new Promise<void>((done) => {
          resolve = done
        })
        pending = { promise, resolve }
        open.set(true)
      }
      return pending.promise
    },
    resolve(): void {
      const current = pending
      pending = null
      open.set(false)
      current?.resolve()
    },
  }
}
export type TermsGate = ReturnType<typeof createTermsGate>

export interface UpgradeRequired {
  minVersion?: string
  storeUrl?: string
}

/** `upgrade_required` (426), or the early check against `GET /public/config`: a blocking screen, nothing else is reachable. */
export function createUpgradeGate() {
  const required = store<UpgradeRequired | null>(null)
  return { get: required.get, subscribe: required.subscribe, require: required.set }
}
export type UpgradeGate = ReturnType<typeof createUpgradeGate>
