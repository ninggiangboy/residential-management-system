import type { Capability, MemberType } from '@rms/shared-types'
import { can } from '@rms/shared-types'
import type { QueryClient } from '@tanstack/react-query'
import { readSafelySync, type SecureStorage, STORAGE_KEYS } from './storage'

/** One active membership as `GET /me` (E-13) lists it: the unit the resident may act for. */
export interface Membership {
  membershipId: string
  unitId: string
  unitCode: string
  memberType: MemberType
  canPay: boolean
}

/**
 * What the app shows after sign-in, decided from the memberships and the stored unit (DOC-55 §7.3 rule 2, UIRA-32, 35, 36):
 * one membership is selected without asking; two or more with no valid stored unit go to `Unit-Pick`; none is the "no unit"
 * state. `stored` is the value to keep: a stored unit that is no longer an active membership is dropped.
 */
export type UnitResolution =
  | { kind: 'selected'; unitId: string; stored: string }
  | { kind: 'pick'; stored: null }
  | { kind: 'none'; stored: null }

export function resolveUnit(
  memberships: readonly Membership[],
  stored: string | null,
): UnitResolution {
  if (memberships.length === 0) return { kind: 'none', stored: null }
  const valid = memberships.find((m) => m.unitId === stored)
  if (valid) return { kind: 'selected', unitId: valid.unitId, stored: valid.unitId }
  const only = memberships.length === 1 ? memberships[0] : undefined
  if (only) return { kind: 'selected', unitId: only.unitId, stored: only.unitId }
  return { kind: 'pick', stored: null }
}

/** The selected unit as an external store: the fetcher reads `get()` for `X-Unit-Id`, the screens subscribe (DOC-55 §7.1). */
export function createUnitStore(storage: SecureStorage, queryClient: QueryClient) {
  let unitId: string | null = readSafelySync(storage, STORAGE_KEYS.unit)
  /** The last unit was lost to a 403 `membership_inactive`: `Unit-Pick` shows its banner (UIRA-37). Cleared by the next `select`. */
  let lost = false
  const listeners = new Set<() => void>()
  const write = (next: string | null) => {
    unitId = next
    try {
      if (next === null) void storage.remove(STORAGE_KEYS.unit)
      else storage.setSync(STORAGE_KEYS.unit, next)
    } catch {
      // The selection is kept in memory for this run.
    }
    for (const listener of listeners) listener()
  }
  return {
    get: () => unitId,
    wasLost: () => lost,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /**
     * `select(newId)` writes the id, then removes the previous unit's queries from memory, so nothing of it can show for a moment
     * under the new unit (DOC-55 §7.3 rule 1, CL-24). `['unit', previous]` is the key prefix of every unit-bound query.
     */
    select(next: string): void {
      const previous = unitId
      if (previous === next) return
      lost = false
      write(next)
      if (previous !== null) queryClient.removeQueries({ queryKey: ['unit', previous] })
    },
    /** A lost unit (403 `membership_inactive`) or a stored id that is no longer a membership: its data goes with it. */
    drop(options: { lost?: boolean } = {}): void {
      const previous = unitId
      lost = options.lost === true
      write(null)
      if (previous !== null) queryClient.removeQueries({ queryKey: ['unit', previous] })
    },
  }
}

export type UnitStore = ReturnType<typeof createUnitStore>

/** `can(capability)` for the selected membership: it only hides or disables a control, the server decides (DOC-55 §7.1). */
export const capabilityOf = (membership: Membership | null, capability: Capability): boolean =>
  membership !== null && can(membership, capability)
