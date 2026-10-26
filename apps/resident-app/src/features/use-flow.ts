import { resolveUnit, useRuntime, useSelectedUnitId, useSession } from '@rms/mobile-core'
import { useEffect, useSyncExternalStore } from 'react'
import { useMe, useTerms } from '../api/hooks'

/**
 * Where the resident is in the sign-in sequence, read from the answers and not from local flags (DOC-57 "The sign-in sequence",
 * DOC-55 §5, §7.3): the session, then `GET /me`, then `GET /me/terms`, then the unit. The root layout turns each phase into a
 * `Stack.Protected` guard; the guards are a convenience, the server decides on every request (DOC-55 §17).
 */
type Phase = 'booting' | 'signedOut' | 'loading' | 'error' | 'terms' | 'unit' | 'ready'

export function useFlow() {
  const { unit, termsGate, session: store } = useRuntime()
  const session = useSession()
  const storedUnit = useSelectedUnitId()
  const gateOpen = useSyncExternalStore(termsGate.subscribe, termsGate.isOpen, termsGate.isOpen)
  const live = session.status === 'signedIn' || session.status === 'unknown'
  const me = useMe(live)
  const terms = useTerms(session.status === 'signedIn')

  const memberships = me.data?.memberships ?? []
  const resolution = resolveUnit(memberships, storedUnit)
  const kind = resolution.kind
  const resolvedUnit = resolution.kind === 'selected' ? resolution.unitId : null

  // The stored unit follows the memberships: one membership is selected without asking, a unit that is no longer an active
  // membership is deleted, and with two or more the resident chooses (UIRA-32, UIRA-35).
  useEffect(() => {
    if (!me.data) return
    if (resolvedUnit !== null && resolvedUnit !== storedUnit) unit.select(resolvedUnit)
    else if (kind !== 'selected' && storedUnit !== null) unit.drop()
  }, [me.data, kind, resolvedUnit, storedUnit, unit])

  // An error reading the terms does not stop the app: the server refuses a call with 403 `terms_required` and the gate opens then.
  const termsAccepted = terms.isError || (terms.data?.items.every((item) => item.accepted) ?? false)

  let phase: Phase
  if (session.status === 'booting') phase = 'booting'
  else if (session.status === 'signedOut') phase = 'signedOut'
  else if (me.isPending) phase = 'loading'
  else if (!me.data) phase = 'error'
  else if (session.status === 'signedIn' && terms.isPending) phase = 'loading'
  else if (!termsAccepted) phase = 'terms'
  else if (kind !== 'selected') phase = 'unit'
  else phase = 'ready'

  return {
    phase,
    gateOpen,
    memberships,
    /** Starts again after an error: a session with no answer boots again, then the reads. */
    retry: () => {
      if (session.status === 'unknown') void store.boot()
      void me.refetch()
      void terms.refetch()
    },
  }
}
