import { useSyncExternalStore } from 'react'
import { safeStorage } from './utils'

/** `system` follows `prefers-color-scheme`; `light` and `dark` pin one theme on this browser (DR-304, DOC-54 §11). */
export type ThemePreference = 'system' | 'light' | 'dark'

/** The same key `public/boot.js` reads before the first paint. */
const KEY = 'rms.theme'
const storage = safeStorage()

const parse = (value: string | null): ThemePreference =>
  value === 'light' || value === 'dark' ? value : 'system'

let current = parse(storage.get(KEY))
const listeners = new Set<() => void>()

/** `tokens.css` holds both themes: an explicit `data-theme` picks one, its absence lets the media query decide. */
function apply(preference: ThemePreference) {
  if (typeof document === 'undefined') return
  if (preference === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = preference
}

function set(next: ThemePreference, persist = true) {
  if (next === current) return
  current = next
  if (persist) {
    if (next === 'system') storage.remove(KEY)
    else storage.set(KEY, next)
  }
  apply(next)
  for (const listener of listeners) listener()
}

apply(current)

// A choice made in another tab applies here too.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) set(parse(event.newValue), false)
  })
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => current)
  return { theme, setTheme: set }
}
