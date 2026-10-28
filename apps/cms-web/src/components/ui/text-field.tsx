import type { InputHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '../../lib/utils'
import { borderFor, controlStyles, FieldFrame, useFieldIds } from './field'
import { Icon } from './icon'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  /** Text after the value, such as a unit ("ngày"). */
  suffix?: ReactNode
  ref?: Ref<HTMLInputElement>
}

export function TextField({ label, hint, error, suffix, className, id, ref, ...props }: TextFieldProps) {
  const ids = useFieldIds(id)
  const describedBy = error ? ids.errorId : hint ? ids.hintId : undefined
  return (
    <FieldFrame {...ids} label={label} hint={hint} error={error} className={className}>
      <div className="relative">
        <input
          ref={ref}
          id={ids.id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(controlStyles, borderFor(Boolean(error)), suffix && 'pr-20')}
          {...props}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-secondary text-ink-muted">
            {suffix}
          </span>
        )}
      </div>
    </FieldFrame>
  )
}

export function TextAreaField({
  label,
  hint,
  error,
  className,
  id,
  rows = 4,
  ref,
  ...props
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> & {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  ref?: Ref<HTMLTextAreaElement>
}) {
  const ids = useFieldIds(id)
  return (
    <FieldFrame {...ids} label={label} hint={hint} error={error} className={className}>
      <textarea
        ref={ref}
        id={ids.id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? ids.errorId : hint ? ids.hintId : undefined}
        className={cn(controlStyles, 'h-auto py-3', borderFor(Boolean(error)))}
        {...props}
      />
    </FieldFrame>
  )
}

/**
 * `SearchField` (DOC-54 §7.2): a text field with the magnifier; the caller debounces. The label is visible, as on every other
 * field, so a filter row of labelled fields lines up.
 */
export function SearchField({
  label,
  hint,
  error,
  className,
  id,
  ref,
  ...props
}: Omit<TextFieldProps, 'type' | 'suffix'> & { label: string }) {
  const ids = useFieldIds(id)
  const describedBy = error ? ids.errorId : hint ? ids.hintId : undefined
  return (
    <FieldFrame {...ids} label={label} hint={hint} error={error} className={className}>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-ink-muted">
          <Icon name="magnifying-glass" />
        </span>
        <input
          ref={ref}
          id={ids.id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(controlStyles, borderFor(Boolean(error)), 'pl-12')}
          {...props}
        />
      </div>
    </FieldFrame>
  )
}
