import NetInfo from '@react-native-community/netinfo'
import { focusManager, onlineManager } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { AppState, type AppStateStatus, Platform } from 'react-native'

let online = true
const listeners = new Set<() => void>()

/**
 * Wires NetInfo to TanStack's `onlineManager` and `AppState` to `focusManager`, once, at start (DOC-55 §8.1, §9.3): foreground
 * and reconnect refetch, offline pauses queries. `isConnected === false` or `isInternetReachable === false` is offline.
 */
export function setupConnectivity(): () => void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      const next = !(state.isConnected === false || state.isInternetReachable === false)
      online = next
      setOnline(next)
      for (const listener of listeners) listener()
    }),
  )
  const onAppState = (status: AppStateStatus) => {
    if (Platform.OS !== 'web') focusManager.setFocused(status === 'active')
  }
  const subscription = AppState.addEventListener('change', onAppState)
  return () => subscription.remove()
}

/** `useCanWrite()`: false while offline, so a button that writes is disabled with the reason instead of failing (DOC-55 §9.3). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => online,
    () => true,
  )
}
