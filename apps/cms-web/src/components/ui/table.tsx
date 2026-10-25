import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'
import { Card } from './card'

/** The data table card (DOC-54 §7.5): a scroll box with a minimum width, rows 12 × 24 px, header 13 px muted. */
export function DataTable({
  children,
  footer,
  label,
  minWidth = 'min-w-[880px]',
}: {
  children: ReactNode
  footer?: ReactNode
  label: string
  minWidth?: string
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table aria-label={label} className={cn('w-full border-collapse text-left', minWidth)}>
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
      className={cn('border-b border-line px-6 py-3 text-caption font-medium text-ink-muted', className)}
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
