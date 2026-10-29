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
    <div className={cn('flex flex-col gap-2', className)}>
      {label && (
        <label htmlFor={id} className={labelStyles}>
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

/** The label of a field (14 px, weight 500, after shadcn's `Label`), 8 px above it; a group drawn by hand uses it too. */
export const labelStyles = 'text-label text-ink'

/**
 * A text field, text area or select, after shadcn's `Input` (DR-311): white, a 1 px `line-input` border and `shadow-field`;
 * focus turns the border `teal` with the 3 px `shadow-focus` ring; a field in error has the `danger` border and ring, at
 * rest too, and its error written under it (DOC-54 §12 A4, A8).
 */
export const controlStyles =
  'h-control-md w-full min-w-0 rounded-control border bg-surface px-3 text-body text-ink shadow-field outline-none placeholder:text-ink-muted transition-[color,border-color,box-shadow] duration-150 focus-visible:border-teal focus-visible:shadow-focus aria-invalid:shadow-invalid aria-invalid:focus-visible:border-danger aria-invalid:focus-visible:shadow-invalid disabled:cursor-not-allowed disabled:bg-fill disabled:text-ink-muted disabled:shadow-none [&:is(input,textarea):read-only]:bg-fill [&:is(input,textarea):read-only]:shadow-none'
/** `line-input`, or `danger` on a field in error. */
export const borderFor = (error: boolean) => (error ? 'border-danger' : 'border-line-input')
