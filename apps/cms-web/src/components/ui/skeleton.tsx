import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

/**
 * A placeholder bar. It fades in only after 150 ms, so an answer faster than that replaces it before it is ever seen and a
 * fast API shows no flash (DR-306, DOC-68 §2 "Loading"). `immediate` is for a frame that continues one already on screen (the
 * shell after the static frame of `index.html`).
 */
export function Skeleton({
  className,
  immediate = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { immediate?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        immediate ? 'motion-skeleton-now' : 'motion-skeleton',
        'rounded-control bg-fill',
        className,
      )}
      {...props}
    />
  )
}
