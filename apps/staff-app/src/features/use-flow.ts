import { useRuntime, useSession } from '@rms/mobile-core'
import { useStaffMe } from '../api/hooks'

/**
 * Where the staff member is (DOC-61): the session, then `GET /staff/me`. An Admin signs in fine on the API and then meets the
 * wrong-client page (DR-174); everyone else lands on `S-Account` until a role's first screen ships.
 */
type Phase = 'booting' | 'signedOut' | 'loading' | 'error' | 'wrongApp' | 'ready'

export function useFlow() {
  const { session: store } = useRuntime()
  const session = useSession()
  const live = session.status === 'signedIn' || session.status === 'unknown'
  const me = useStaffMe(live)

  let phase: Phase
  if (session.status === 'booting') phase = 'booting'
  else if (session.status === 'signedOut') phase = 'signedOut'
  else if (me.isPending) phase = 'loading'
  else if (!me.data) phase = 'error'
  else if (me.data.role === 'admin') phase = 'wrongApp'
  else phase = 'ready'

  return {
    phase,
    retry: () => {
      if (session.status === 'unknown') void store.boot()
      void me.refetch()
    },
  }
}
