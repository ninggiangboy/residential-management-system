import type { UsageTracker } from '@rms/client-core'
import { AppState } from 'react-native'

/**
 * Binds the tracker to the app state of the device (DOC-104 §5.6): `active` opens a stretch and `background` closes it. `inactive` (a
 * call, the control center, a permission dialog) closes nothing. Returns the unbinding.
 */
export function bindAppState(usage: UsageTracker): () => void {
  if (AppState.currentState === 'active') usage.foreground(true)
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') usage.foreground(true)
    else if (state === 'background') usage.foreground(false)
  })
  return () => subscription.remove()
}
