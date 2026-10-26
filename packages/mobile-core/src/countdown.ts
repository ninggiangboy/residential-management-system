import { useEffect, useState } from 'react'

/** Whole seconds until `deadlineMs`, rounded up and never negative: at 44 s of a 45 s wait it reads 1 (UIRA-16). */
export const secondsLeft = (deadlineMs: number, nowMs: number): number =>
  Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000))

/**
 * A countdown to a deadline on the monotonic clock (`performance.now`), so a changed device clock cannot shorten a wait
 * (DOC-57 `OTP`, UX-03). The deadline is `now() + seconds * 1000` taken when the answer arrived. `null` is "no countdown" (0).
 */
export function useCountdown(
  deadlineMs: number | null,
  now: () => number = () => performance.now(),
): number {
  const [left, setLeft] = useState(() => (deadlineMs === null ? 0 : secondsLeft(deadlineMs, now())))
  useEffect(() => {
    if (deadlineMs === null) return setLeft(0)
    const tick = () => setLeft(secondsLeft(deadlineMs, now()))
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [deadlineMs, now])
  return left
}
