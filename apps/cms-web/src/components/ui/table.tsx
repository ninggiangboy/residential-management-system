import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { useDelayedFlag } from '../../lib/use-delayed-flag'
import { cn } from '../../lib/utils'
import { Card } from './card'
import { Skeleton } from './skeleton'

/**
 * The data table card (DOC-54 §7.5): a scroll box with a minimum width, rows 12 × 24 px, header 13 px muted. Inside a
 * `ListPage` the card is as tall as its rows but never taller than the window: the rows scroll inside it under a sticky header,
 * and the pager stays in view; another page or filter starts at the first row.
 */
export function DataTable({
  children,
  footer,
  label,
  minWidth = 'min-w-[880px]',
  busy = false,
}: {
  children: ReactNode
  footer?: ReactNode
  label: string
  minWidth?: string
  /** A new page or filter is loading over the rows shown: they stay, dimmed, under a thin bar, so nothing jumps. */
  busy?: boolean
}) {
  // The dimming and the bar wait 150 ms and then stay 300 ms: a fast answer changes the rows without a blink (DR-306).
  const dimmed = useDelayedFlag(busy, 150, 300)
  return (
    <Card className="relative flex min-h-0 flex-col overflow-hidden">
      {dimmed && (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden" aria-hidden="true">
          <div className="motion-progress h-full w-1/3 rounded-full bg-teal" />
        </div>
      )}
      {/* `data-table-scroll`: the router starts it at the top on a new page or filter (`scrollToTopSelectors`, main.tsx). */}
      <div data-table-scroll className="gutter-stable min-h-0 flex-1 overflow-auto">
        {/* Separate borders, not collapsed: a collapsed border does not move with the sticky header. */}
        <table
          aria-label={label}
          aria-busy={busy || undefined}
          className={cn(
            'w-full border-separate border-spacing-0 text-left [&>tbody]:transition-opacity [&>tbody]:duration-200',
            dimmed && '[&>tbody]:opacity-60',
            minWidth,
          )}
        >
          {children}
        </table>
      </div>
      {footer && (
        <div className="gutter-stable flex shrink-0 items-center justify-between gap-4 overflow-hidden border-t border-line px-6 py-3">
          {footer}
        </div>
      )}
    </Card>
  )
}

export const THead = (props: HTMLAttributes<HTMLTableSectionElement>) => <thead {...props} />
export const TBody = (props: HTMLAttributes<HTMLTableSectionElement>) => <tbody {...props} />

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'sticky top-0 z-[1] whitespace-nowrap border-b border-line bg-surface px-6 py-3 text-caption font-medium text-ink-muted',
        className,
      )}
      {...props}
    />
  )
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-b border-line px-6 py-3 text-body text-ink align-middle', className)} {...props} />
}

export function Tr({
  className,
  interactive,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return <tr className={cn('last:[&>td]:border-b-0', interactive && 'hover:bg-ground/60', className)} {...props} />
}

/*
 * Caps, not widths: a bar is as wide as its cell up to the cap. A fixed width would set the column's minimum and override the
 * header's width, so the skeleton table grew wider than the card (a scrollbar while loading, columns moving when rows came).
 */
const WIDTHS = ['max-w-24', 'max-w-12', 'max-w-16', 'max-w-20', 'max-w-28', 'max-w-36', 'max-w-14', 'max-w-6']

/**
 * The rows of a table whose first page is loading: one bar per column under the real header, in the row height of the data
 * (`rowClassName`, e.g. `h-[69px]` for two-line cells), so the table keeps its shape when the rows arrive.
 */
export function SkeletonRows({
  columns,
  rows = 8,
  rowClassName,
}: {
  columns: number
  rows?: number
  rowClassName?: string
}) {
  return (
    <TBody aria-hidden="true">
      {Array.from({ length: rows }, (_, row) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
        <Tr key={row} className={rowClassName}>
          {Array.from({ length: columns }, (_, column) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
            <Td key={column}>
              <Skeleton className={cn('h-4 w-full', WIDTHS[(column + row) % WIDTHS.length])} />
            </Td>
          ))}
        </Tr>
      ))}
    </TBody>
  )
}
