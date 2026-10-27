import { statusRow, type Tone } from '@rms/design-tokens'
import type { MessageKey } from '@rms/i18n-catalog/web'
import type { ReactNode } from 'react'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { Icon } from './icon'

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-fill text-ink-muted',
  info: 'bg-info-soft text-on-info-soft',
  success: 'bg-success-soft text-on-success-soft',
  warning: 'bg-lamp-soft text-on-lamp-soft',
  danger: 'bg-danger-soft text-on-danger-soft',
}
const TONE_ICON = {
  neutral: null,
  info: 'info',
  success: 'check-circle',
  warning: 'warning',
  danger: 'x-circle',
} as const

/** The text label always, plus the leading icon of the tones that carry one (DR-183, DOC-54 §6.1). */
export function Tag({
  tone = 'neutral',
  icon = true,
  children,
  className,
}: {
  tone?: Tone
  icon?: boolean
  children: ReactNode
  className?: string
}) {
  const name = TONE_ICON[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-caption whitespace-nowrap',
        TONE_CLASS[tone],
        className,
      )}
    >
      {icon && name && <Icon name={name} size="sm" weight="fill" />}
      {children}
    </span>
  )
}

/** A tag from the table of DOC-54 §6 (`status.json`): the tone, the icon and the catalog label of a domain value. */
export function StatusTag({
  entity,
  value,
  when,
}: {
  entity: string
  value: string
  when?: string
}) {
  const t = useT()
  const row = statusRow(entity, value, 'staff', when)
  if (!row) return <Tag>{value}</Tag>
  return (
    <Tag tone={row.tone} icon={row.icon !== null}>
      {t(row.label as MessageKey)}
    </Tag>
  )
}

/** The unit code: the near-square plate of DOC-54 §4. */
export function Plate({
  children,
  size = 'sm',
  className,
}: {
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const style = { sm: 'text-plate-sm px-2 py-0.5', md: 'text-plate-md px-3 py-1', lg: 'text-plate-lg px-4 py-1.5' }
  return (
    <span
      className={cn(
        'inline-block rounded-plate bg-plate font-plate text-on-plate tabular-nums',
        style[size],
        className,
      )}
    >
      {children}
    </span>
  )
}
