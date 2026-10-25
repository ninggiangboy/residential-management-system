import type { ReactNode } from 'react'

/** The page header of every `W-` screen: `h1` (title-1), one line of subtitle, actions at the right (DOC-54 §8.1). */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-title-1 text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-secondary text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  )
}
