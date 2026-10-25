import { useSyncExternalStore } from 'react'

const subscribe = (listener: () => void) => {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

/** `navigator.onLine` (UX-04): the web reads it through the default online manager of the query library. */
export const useOnline = () =>
  useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )

/** Every button that writes is disabled while offline, with the reason in the banner (UX-04, DOC-55 §9.3). */
export const useCanWrite = () => useOnline()
