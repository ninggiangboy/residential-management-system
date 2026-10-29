import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { Icon } from './icon'

const TONES = {
  info: { box: 'bg-info-soft text-on-info-soft', icon: 'info' },
  neutral: { box: 'bg-fill text-ink', icon: 'info' },
  warning: { box: 'bg-lamp-soft text-on-lamp-soft', icon: 'warning' },
  danger: { box: 'bg-danger-soft text-on-danger-soft', icon: 'x-circle' },
  success: { box: 'bg-success-soft text-on-success-soft', icon: 'check-circle' },
} as const

/** A message above the content that stays until the user acts (DOC-68 §2); `role` follows how urgent the tone is. */
export function Banner({
  tone = 'info',
  title,
  children,
  actions,
  className,
}: {
  tone?: keyof typeof TONES
  title?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  const style = TONES[tone]
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2.5 rounded-control px-3 py-2.5 text-secondary', style.box, className)}
    >
      {/* The icon sits in a box as tall as the first line, so it stays on that line's centre whether the text runs to one
          line or several, with or without a title. */}
      <span className={cn('flex shrink-0 items-center', title ? 'h-5' : 'h-4.5')}>
        <Icon name={style.icon} size="sm" weight="fill" />
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className="text-body-strong">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2 self-center">{actions}</div>}
    </div>
  )
}
