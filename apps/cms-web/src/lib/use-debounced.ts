import { useEffect, useState } from 'react'

/** The value after it has stopped changing for `delay` ms (a search box sends one request after the pause, UIWR-03). */
export function useDebounced<V>(value: V, delay = 300): V {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
