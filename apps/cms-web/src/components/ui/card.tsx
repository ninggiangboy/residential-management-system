import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-line bg-surface shadow-raised', className)} {...props} />
}

export function CardSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('p-5', className)}>
      {(title || actions) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-title-3 text-ink">{title}</h2>}
            {description && <p className="text-secondary text-ink-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </Card>
  )
}
