import { Select } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { borderFor, controlStyles, FieldFrame, useFieldIds } from './field'
import { Icon } from './icon'

export interface SelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

/** A Radix select (DOC-54 §7.2 `SelectField`). An empty value means "nothing chosen"; the placeholder shows then. */
export function SelectField({
  label,
  hint,
  error,
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  id,
  className,
  name,
  required,
}: {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  value: string
  onValueChange: (value: string) => void
  options: readonly SelectOption[]
  placeholder?: string
  disabled?: boolean
  id?: string
  className?: string
  name?: string
  required?: boolean
}) {
  const ids = useFieldIds(id)
  const chosen = options.find((option) => option.value === value)?.label
  // A string label is drawn by a read-only input laid over the trigger, with the classes of a text field: Chrome on macOS sets
  // an input's text 0.5 px lower than the same text in a button or div (and an input inside a button like the button), so the
  // value would sit a device pixel above a text field beside it. Any other label is drawn by Radix inside the trigger.
  const drawn = value === '' ? '' : typeof chosen === 'string' ? chosen : null
  return (
    <FieldFrame
      {...ids}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <Select.Root
        value={value === '' ? undefined : value}
        onValueChange={onValueChange}
        disabled={disabled}
        name={name}
        required={required}
      >
        <div className="relative">
          <Select.Trigger
            id={ids.id}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? ids.errorId : hint ? ids.hintId : undefined}
            className={cn(
              controlStyles,
              borderFor(Boolean(error)),
              'flex items-center justify-between gap-2 text-left data-[placeholder]:text-ink-disabled',
            )}
          >
            {/* Radix drops a `className` on `Select.Value`, so the wrapper hides it. */}
            <span className={drawn === null ? 'min-w-0 truncate' : 'sr-only'}>
              <Select.Value placeholder={placeholder} />
            </span>
            <Select.Icon className="ml-auto">
              <Icon name="caret-down" size="sm" className="text-ink-muted" />
            </Select.Icon>
          </Select.Trigger>
          {drawn === null ? null : (
            <input
              readOnly
              tabIndex={-1}
              aria-hidden
              value={drawn}
              placeholder={placeholder}
              disabled={disabled}
              className={cn(
                controlStyles,
                // `!bg-transparent` beats the read-only and disabled fills of `controlStyles`, which belong to the trigger below.
                'pointer-events-none absolute inset-0 truncate border-transparent !bg-transparent pr-9 shadow-none outline-none',
              )}
            />
          )}
        </div>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={4}
            className="motion-pop z-[100] max-h-72 origin-(--radix-select-content-transform-origin) min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-control border border-line bg-surface shadow-float"
          >
            <Select.Viewport className="p-1">
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="flex min-h-control-sm cursor-pointer items-center gap-2 rounded-plate px-2 text-body text-ink outline-none data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-disabled data-[highlighted]:bg-fill data-[state=checked]:bg-teal-soft data-[state=checked]:text-on-teal-soft"
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </FieldFrame>
  )
}
