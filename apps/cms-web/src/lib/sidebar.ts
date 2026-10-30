import { useSyncExternalStore } from 'react'
import { safeStorage } from './utils'

/**
 * From 1024 px the sidebar is full (248 px) unless the user collapsed it to the 72 px rail; below 1024 px it is always the rail
 * (DOC-54 §8.1, DR-312). The choice lives in this browser only. `data-sidebar` on the root draws it, so the `nav-full:` variant
 * of `styles.css`, `ShellSkeleton` and the `#boot` frame follow it without JavaScript.
 */
const KEY = 'rms.sidebar'
const WIDE = '(min-width: 64rem)'
const storage = safeStorage()

const parse = (value: string | null) => value === 'collapsed'

let collapsed = parse(storage.get(KEY))
const listeners = new Set<() => void>()
const notify = () => {
  for (const listener of listeners) listener()
}

function apply(next: boolean) {
  if (typeof document === 'undefined') return
  if (next) document.documentElement.dataset.sidebar = 'collapsed'
  else delete document.documentElement.dataset.sidebar
}

function set(next: boolean, persist = true) {
  if (next === collapsed) return
  collapsed = next
  if (persist) {
    if (next) storage.set(KEY, 'collapsed')
    else storage.remove(KEY)
  }
  apply(next)
  notify()
}

apply(collapsed)

const media = typeof window === 'undefined' ? null : window.matchMedia(WIDE)
if (typeof window !== 'undefined') {
  // A choice made in another tab applies here too.
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) set(parse(event.newValue), false)
  })
  media?.addEventListener('change', notify)
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** `rail` is what the screen draws: the icons alone, whose names then show as tooltips. */
export function useSidebar() {
  const isCollapsed = useSyncExternalStore(subscribe, () => collapsed)
  const wide = useSyncExternalStore(subscribe, () => media?.matches ?? true)
  return {
    collapsed: isCollapsed,
    /** Only a wide window can show the full sidebar, so only there does the toggle do anything. */
    wide,
    rail: isCollapsed || !wide,
    toggle: () => set(!collapsed),
  }
}
