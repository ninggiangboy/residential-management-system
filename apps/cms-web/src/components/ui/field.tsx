import { type ReactNode, useId } from 'react'
import { cn } from '../../lib/utils'

/** The ids that tie a label, a hint and an error text to one control (UX-13). */
export function useFieldIds(id?: string) {
  const generated = useId()
  const base = id ?? generated
  return { id: base, hintId: `${base}-hint`, errorId: `${base}-error` }
}

export function FieldFrame({
  id,
  label,
  hint,
  error,
  hintId,
  errorId,
  children,
  className,
}: {
  id: string
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  hintId: string
  errorId: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-caption text-ink">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p id={errorId} role="alert" className="text-secondary text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-secondary text-ink-muted">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

export const controlStyles =
  'h-control-lg w-full rounded-control border bg-surface px-4 text-body text-ink placeholder:text-ink-disabled outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-fill disabled:text-ink-muted read-only:bg-fill'
export const borderFor = (error: boolean) => (error ? 'border-danger' : 'border-line-strong')
