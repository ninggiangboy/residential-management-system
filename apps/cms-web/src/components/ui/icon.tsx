import type { IconName } from '@rms/design-tokens'
import { type Icon as PhosphorIcon, XCircle } from '@phosphor-icons/react'
import { lazy, Suspense } from 'react'
import { cn } from '../../lib/utils'

/**
 * The icon of a failed sign-in (the danger banner): they ship with the first load. Every other name comes from
 * `icons-all`, a chunk fetched once when a signed-in screen first needs it (the budget of DOC-53 §8, DR-264).
 */
const CORE: Partial<Record<IconName, PhosphorIcon>> = {
  'x-circle': XCircle,
}

const SIZES = { sm: 'size-icon-sm', md: 'size-icon-md', lg: 'size-icon-lg' } as const

interface IconProps {
  name: IconName
  size?: keyof typeof SIZES
  weight?: 'regular' | 'fill' | 'bold'
  /** Present when the icon alone carries a meaning; a decorative icon is hidden from assistive technology (DOC-54 §7.3). */
  label?: string
  className?: string
}

const Rest = lazy(() => import('./icons-all').then((module) => ({ default: module.ICONS_BY_NAME })))

export function Icon({ name, size = 'md', weight = 'regular', label, className }: IconProps) {
  const classes = cn('shrink-0', SIZES[size], className)
  const accessible = { 'aria-hidden': label ? undefined : true, 'aria-label': label, role: label ? 'img' : undefined } as const
  const Core = CORE[name]
  if (Core) return <Core weight={weight} className={classes} {...accessible} />
  return (
    <Suspense fallback={<span className={classes} aria-hidden="true" />}>
      <Rest name={name} weight={weight} className={classes} {...accessible} />
    </Suspense>
  )
}
