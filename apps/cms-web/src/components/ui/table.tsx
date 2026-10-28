import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { useDelayedFlag } from '../../lib/use-delayed-flag'
import { cn } from '../../lib/utils'
import { Card } from './card'
import { Skeleton } from './skeleton'

/** The data table card (DOC-54 §7.5): a scroll box with a minimum width, rows 12 × 24 px, header 13 px muted. */
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
    <Card className="relative overflow-hidden">
      {dimmed && (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden" aria-hidden="true">
          <div className="motion-progress h-full w-1/3 rounded-full bg-teal" />
        </div>
      )}
      <div className="overflow-x-auto">
        <table
          aria-label={label}
          aria-busy={busy || undefined}
          className={cn(
            'w-full border-collapse text-left [&>tbody]:transition-opacity [&>tbody]:duration-200',
            dimmed && '[&>tbody]:opacity-60',
            minWidth,
          )}
        >
          {children}
        </table>
      </div>
      {footer && <div className="flex items-center justify-between gap-4 border-t border-line px-6 py-3">{footer}</div>}
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
        'whitespace-nowrap border-b border-line px-6 py-3 text-caption font-medium text-ink-muted',
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

const WIDTHS = ['w-24', 'w-12', 'w-16', 'w-20', 'w-28', 'w-36', 'w-14', 'w-6']

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
              <Skeleton className={cn('h-4', WIDTHS[(column + row) % WIDTHS.length])} />
            </Td>
          ))}
        </Tr>
      ))}
    </TBody>
  )
}
