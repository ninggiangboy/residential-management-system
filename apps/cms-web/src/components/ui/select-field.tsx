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
}) {
  const ids = useFieldIds(id)
  return (
    <FieldFrame {...ids} label={label} hint={hint} error={error} className={className}>
      <Select.Root
        value={value === '' ? undefined : value}
        onValueChange={onValueChange}
        disabled={disabled}
        name={name}
      >
        <Select.Trigger
          id={ids.id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ids.errorId : hint ? ids.hintId : undefined}
          className={cn(
            controlStyles,
            borderFor(Boolean(error)),
            'inline-flex items-center justify-between gap-2 text-left data-[placeholder]:text-ink-disabled',
          )}
        >
          <Select.Value placeholder={placeholder} />
          <Select.Icon>
            <Icon name="caret-down" size="sm" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={6}
            className="motion-pop z-50 max-h-72 origin-(--radix-select-content-transform-origin) min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-control border border-line bg-surface shadow-float"
          >
            <Select.Viewport className="p-1">
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="flex min-h-control-md cursor-pointer items-center gap-2 rounded-control px-3 text-body text-ink outline-none data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-disabled data-[highlighted]:bg-fill data-[state=checked]:bg-teal-soft data-[state=checked]:text-on-teal-soft"
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
