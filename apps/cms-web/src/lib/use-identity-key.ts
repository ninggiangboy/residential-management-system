import { useRef } from 'react'

/**
 * A number that changes only when `value` is another object. The query library keeps the same reference when a refetch brings
 * equal data, so a key from this re-runs an entry animation for new rows and not for a background refresh (DR-306).
 */
export function useIdentityKey(value: unknown): number {
  const last = useRef<{ value: unknown; key: number }>({ value, key: 0 })
  if (last.current.value !== value) last.current = { value, key: last.current.key + 1 }
  return last.current.key
}
