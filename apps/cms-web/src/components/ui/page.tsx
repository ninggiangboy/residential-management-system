import type { ReactNode } from 'react'
import { Skeleton } from './skeleton'

/**
 * A list screen (`W-Units`, `W-Residents`, `W-Staff`): as tall as the page area, so its `DataTable` stops at the bottom of the
 * window and scrolls its rows inside; the header, the filters and the pager stay in view.
 */
export function ListPage({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-0 flex-col">{children}</div>
}

/**
 * The page header of every `W-` screen: `h1` (title-1), one line of subtitle, actions at the right (DOC-54 §8.1). A subtitle
 * that comes from data passes `subtitleLoading` while it loads: the line keeps its height, so the filters below do not jump.
 */
export function PageHeader({
  title,
  subtitle,
  subtitleLoading = false,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  subtitleLoading?: boolean
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-title-1 text-ink">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-secondary text-ink-muted">{subtitle}</p>
        ) : (
          subtitleLoading && (
            <div className="mt-1 flex h-4.5 items-center">
              <Skeleton className="h-3 w-72" />
            </div>
          )
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
