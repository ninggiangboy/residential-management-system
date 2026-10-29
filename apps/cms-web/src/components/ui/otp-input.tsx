import { type ReactNode, useRef } from 'react'
import { cn } from '../../lib/utils'
import { FieldFrame, useFieldIds } from './field'

/**
 * Six visible cells over a single input with `autocomplete="one-time-code"` (DOC-54 §7.2 `OtpInput`): paste, autofill and the
 * keyboard all work on the one element, and a screen reader reads one field.
 */
export function OtpInput({
  value,
  onChange,
  label,
  hint,
  error,
  disabled,
  length = 6,
}: {
  value: string
  onChange: (value: string) => void
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  disabled?: boolean
  length?: number
}) {
  const ids = useFieldIds()
  const input = useRef<HTMLInputElement>(null)
  return (
    <FieldFrame {...ids} label={label} hint={hint} error={error}>
      <div className="relative" onClick={() => input.current?.focus()} onKeyDown={() => {}} role="presentation">
        <input
          ref={input}
          id={ids.id}
          value={value}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={length}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ids.errorId : hint ? ids.hintId : undefined}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, length))}
          className="peer absolute inset-0 w-full opacity-0"
        />
        <div className="flex gap-2" aria-hidden="true">
          {Array.from({ length }, (_, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: the cells are positions, they never reorder
              key={index}
              className={cn(
                'flex h-control-lg flex-1 items-center justify-center rounded-control border bg-surface text-title-2 text-ink tabular-nums peer-focus-visible:border-teal',
                error ? 'border-danger' : 'border-line-control',
                value.length === index && 'border-teal',
              )}
            >
              {value[index] ?? ''}
            </span>
          ))}
        </div>
      </div>
    </FieldFrame>
  )
}
