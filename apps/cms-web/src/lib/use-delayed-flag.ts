import { useEffect, useRef, useState } from 'react'

/**
 * A loading indicator that neither flashes nor flickers, whatever the speed of the API (DR-306): `active` shows only once it has
 * lasted `delay` ms, so a fast answer shows nothing, and once shown it stays at least `minimum` ms, so a slightly slower one
 * does not blink. The control it belongs to (a disabled button, the rows kept on screen) reacts at once; only the indicator waits.
 */
export function useDelayedFlag(active: boolean, delay = 150, minimum = 400): boolean {
  const [shown, setShown] = useState(false)
  const shownAt = useRef(0)

  useEffect(() => {
    if (active) {
      if (shown) return
      const timer = window.setTimeout(() => {
        shownAt.current = performance.now()
        setShown(true)
      }, delay)
      return () => window.clearTimeout(timer)
    }
    if (!shown) return
    const left = minimum - (performance.now() - shownAt.current)
    if (left <= 0) {
      setShown(false)
      return
    }
    const timer = window.setTimeout(() => setShown(false), left)
    return () => window.clearTimeout(timer)
  }, [active, shown, delay, minimum])

  return shown
}
