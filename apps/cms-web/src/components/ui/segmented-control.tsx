import { type KeyboardEvent, type ReactNode, useRef } from 'react'
import { cn } from '../../lib/utils'

export interface SegmentOption<V extends string> {
  value: V
  label: ReactNode
  /** The accessible name when `label` is an icon: an icon loads lazily, so it cannot be the name. */
  ariaLabel?: string
  disabled?: boolean
}

/**
 * One choice of a few, always visible (DOC-54 §7.2 `SegmentedControl`): a radio group with a roving tab stop and the arrow keys. It is
 * written without a primitive library because the language switch of the sign-in page is one, and that page's first load is budgeted
 * (DOC-53 §8, DR-264).
 */
export function SegmentedControl<V extends string>({
  value,
  onValueChange,
  options,
  label,
  disabled,
  size = 'md',
  className,
}: {
  value: V
  onValueChange: (value: V) => void
  options: readonly SegmentOption<V>[]
  label: string
  disabled?: boolean
  size?: 'sm' | 'md'
  className?: string
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const enabled = options.filter((option) => !option.disabled)

  const move = (event: KeyboardEvent, from: number) => {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    if (!forward && !backward) return
    event.preventDefault()
    const at = enabled.findIndex((option) => option.value === options[from]?.value)
    const next = enabled[(at + (forward ? 1 : -1) + enabled.length) % enabled.length]
    if (!next) return
    onValueChange(next.value)
    buttons.current[options.indexOf(next)]?.focus()
  }

  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-full bg-fill p-1', className)}>
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.ariaLabel}
            title={option.ariaLabel}
            tabIndex={selected ? 0 : -1}
            disabled={disabled || option.disabled}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              'rounded-full px-4 text-label text-ink-muted outline-offset-2 transition-colors focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50',
              selected && 'bg-surface text-ink shadow-card',
              size === 'sm' ? 'h-8' : 'h-control-md',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
