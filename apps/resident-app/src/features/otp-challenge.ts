import { useSyncExternalStore } from 'react'

/**
 * The challenge of E-09 lives in memory, not in the URL: backgrounding keeps it, killing the app drops it and the resident asks
 * again (DOC-57 `OTP` §2). The deadlines are on the monotonic clock, taken when the answer arrived (UX-03).
 */
export interface Challenge {
  /** The number as typed, shown on the OTP screen. */
  phone: string
  challengeId: string
  resendAtMs: number
  expiresAtMs: number
}

let current: Challenge | null = null
/** The phone typed on `Login`, kept when the resident comes back with "Đổi số điện thoại". */
let typedPhone = ''
const listeners = new Set<() => void>()
const emit = () => {
  for (const listener of listeners) listener()
}

export const challengeStore = {
  get: () => current,
  typedPhone: () => typedPhone,
  set(next: { phone: string; challengeId: string; resendAfter: number; expiresIn: number }): void {
    const now = performance.now()
    typedPhone = next.phone
    current = {
      phone: next.phone,
      challengeId: next.challengeId,
      resendAtMs: now + next.resendAfter * 1000,
      expiresAtMs: now + next.expiresIn * 1000,
    }
    emit()
  },
  clear(): void {
    current = null
    emit()
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

export const useChallenge = (): Challenge | null =>
  useSyncExternalStore(challengeStore.subscribe, challengeStore.get, challengeStore.get)
