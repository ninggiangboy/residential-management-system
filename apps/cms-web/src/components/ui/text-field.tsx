import {
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  useCallback,
  useState,
} from 'react'
import { cn } from '../../lib/utils'
import { borderFor, controlStyles, FieldFrame, useFieldIds } from './field'
import { Icon } from './icon'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  /** Text after the value, such as a unit ("ngày", "m²"). */
  suffix?: ReactNode
  ref?: Ref<HTMLInputElement>
}

/**
 * The width of a suffix, measured, so the value stops before it whatever its length ("m²", "ngày sau ngày tạo đợt") and in
 * either language. React 19 runs the cleanup a ref callback returns.
 */
function useSuffixWidth() {
  const [width, setWidth] = useState<number>()
  const ref = useCallback((node: HTMLSpanElement | null) => {
    if (!node) return
    const observer = new ResizeObserver(() => setWidth(node.offsetWidth))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [width, ref] as const
}

export function TextField({
  label,
  hint,
  error,
  suffix,
  className,
  id,
  required,
  style,
  ref,
  ...props
}: TextFieldProps) {
  const ids = useFieldIds(id)
  const [suffixWidth, suffixRef] = useSuffixWidth()
  const describedBy = error ? ids.errorId : hint ? ids.hintId : undefined
  return (
    <FieldFrame
      {...ids}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <div className="relative">
        <input
          ref={ref}
          id={ids.id}
          aria-invalid={error ? true : undefined}
          required={required}
          aria-describedby={describedBy}
          // The suffix sits 12 px from the edge with 8 px before it.
          style={suffix && suffixWidth ? { paddingRight: suffixWidth + 20, ...style } : style}
          className={cn(controlStyles, borderFor(Boolean(error)), suffix && 'pr-14')}
          {...props}
        />
        {suffix && (
          <span
            ref={suffixRef}
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-secondary text-ink-muted">
            {suffix}
          </span>
        )}
      </div>
    </FieldFrame>
  )
}

/** The padding (`py-2`) and border of a text area, added to its lines. */
const linesHeight = (lines: number) => `calc(${lines} * 1lh + 1rem + 2px)`

/**
 * A text area (DOC-54 §17.9): `rows` lines high at rest, growing with its text up to `maxRows` (then it scrolls), and the
 * user may drag it taller. `field-sizing: content` does the growing where the browser has it; elsewhere it stays at `rows`.
 * Text areas side by side give `maxRows={rows}`, so they keep one height.
 */
export function TextAreaField({
  label,
  hint,
  error,
  className,
  id,
  rows = 4,
  maxRows = 12,
  required,
  style,
  ref,
  ...props
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> & {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  maxRows?: number
  ref?: Ref<HTMLTextAreaElement>
}) {
  const ids = useFieldIds(id)
  const sizing: CSSProperties = {
    minHeight: linesHeight(rows),
    maxHeight: maxRows > rows ? linesHeight(maxRows) : undefined,
    height: maxRows > rows ? undefined : linesHeight(rows),
    ...style,
  }
  return (
    <FieldFrame
      {...ids}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <textarea
        ref={ref}
        id={ids.id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        required={required}
        aria-describedby={error ? ids.errorId : hint ? ids.hintId : undefined}
        style={sizing}
        className={cn(
          controlStyles,
          'h-auto resize-y py-2',
          maxRows > rows && '[field-sizing:content]',
          borderFor(Boolean(error)),
        )}
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
  required,
  ref,
  ...props
}: Omit<TextFieldProps, 'type' | 'suffix'> & { label: string }) {
  const ids = useFieldIds(id)
  const describedBy = error ? ids.errorId : hint ? ids.hintId : undefined
  return (
    <FieldFrame
      {...ids}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-muted">
          <Icon name="magnifying-glass" size="sm" />
        </span>
        <input
          ref={ref}
          id={ids.id}
          aria-invalid={error ? true : undefined}
          required={required}
          aria-describedby={describedBy}
          className={cn(controlStyles, borderFor(Boolean(error)), 'pl-9')}
          {...props}
        />
      </div>
    </FieldFrame>
  )
}
