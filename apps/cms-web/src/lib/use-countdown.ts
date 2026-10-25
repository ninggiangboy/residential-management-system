import { useCallback, useEffect, useState } from 'react'

/**
 * A wait counted on the monotonic clock of the device, never on the wall clock (UX-03, DOC-64 `W-Forgot-Sent`): `start(seconds)`
 * begins it, `secondsLeft` falls to 0 and stays there.
 */
export function useCountdown(initialSeconds = 0) {
  const [deadline, setDeadline] = useState<number | null>(
    initialSeconds > 0 ? performance.now() + initialSeconds * 1000 : null,
  )
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    if (deadline === null) return
    const tick = () => setNow(performance.now())
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [deadline])

  const start = useCallback((seconds: number) => {
    const at = performance.now()
    setNow(at)
    setDeadline(at + seconds * 1000)
  }, [])

  const secondsLeft = deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000))
  return { secondsLeft, start }
}

/** `mm:ss`. */
export const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
