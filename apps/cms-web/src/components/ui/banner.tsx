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
      className={cn('flex items-start gap-3 rounded-card p-4 text-secondary', style.box, className)}
    >
      <Icon name={style.icon} weight="fill" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {title && <p className="text-body-strong">{title}</p>}
        {children && <div>{children}</div>}
      </div>
      {actions}
    </div>
  )
}
