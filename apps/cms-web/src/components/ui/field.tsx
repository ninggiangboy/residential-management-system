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
  required,
}: {
  id: string
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  hintId: string
  errorId: string
  children: ReactNode
  className?: string
  /** Marks the label with a `danger` asterisk; the control carries `aria-required` (DOC-54 §17.9). */
  required?: boolean
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-caption text-ink">
          {label}
          {required && (
            <span aria-hidden="true" className="ml-0.5 text-danger">
              *
            </span>
          )}
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

/** A text field, text area or select: the focus is a 2 px `teal` inner ring, `danger` on a field in error (DOC-54 §12 A4, A8). */
export const controlStyles =
  'h-control-md w-full rounded-control border bg-surface px-3 text-body text-ink shadow-raised placeholder:text-ink-disabled transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal aria-invalid:focus-visible:outline-danger disabled:cursor-not-allowed disabled:bg-fill disabled:text-ink-muted [&:is(input,textarea):read-only]:bg-fill'
/** `line-control`, the lightest border that keeps 3:1, darkening under the pointer (DOC-54 §5.5, DR-307). */
export const borderFor = (error: boolean) =>
  error ? 'border-danger' : 'border-line-control hover:border-line-strong'
