import type { IconName } from '@rms/design-tokens'
import { type Icon as PhosphorIcon, XCircle } from '@phosphor-icons/react'
import { useSyncExternalStore } from 'react'
import { cn } from '../../lib/utils'

/**
 * The icon of a failed sign-in (the danger banner): they ship with the first load. Every other name comes from
 * `icons-all`, a chunk fetched once at start (the budget of DOC-53 §8, DR-264).
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

// The chunk starts downloading as soon as this module runs, not when the first icon renders, and stays a chunk of its own:
// the sign-in budget counts only what the entry imports statically. It is a store, not `React.lazy`: a lazy component
// suspends on its first render even when its chunk is already here, and React holds a revealed Suspense boundary back for
// about 300 ms, so the icons of a page that had just drawn appeared late (the theme switch of the top bar, DR-306).
let registry: Record<IconName, PhosphorIcon> | null = null
const listeners = new Set<() => void>()
void import('./icons-all').then((module) => {
  registry = module.ICONS
  for (const listener of listeners) listener()
})
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function Icon({ name, size = 'md', weight = 'regular', label, className }: IconProps) {
  const icons = useSyncExternalStore(
    subscribe,
    () => registry,
    () => null,
  )
  const classes = cn('shrink-0', SIZES[size], className)
  const accessible = { 'aria-hidden': label ? undefined : true, 'aria-label': label, role: label ? 'img' : undefined } as const
  const Component = CORE[name] ?? icons?.[name]
  // Before the chunk arrives the icon keeps its box, so nothing moves when it is drawn.
  if (!Component) return <span className={classes} aria-hidden="true" />
  return <Component weight={weight} className={classes} {...accessible} />
}
