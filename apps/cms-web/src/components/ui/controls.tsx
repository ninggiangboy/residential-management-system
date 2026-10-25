import { Checkbox as RadixCheckbox, RadioGroup, Switch as RadixSwitch } from 'radix-ui'
import { type ReactNode, useId } from 'react'
import { cn } from '../../lib/utils'
import { Icon } from './icon'

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled,
  className,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <RadixCheckbox.Root
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        disabled={disabled}
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-plate border border-line-strong bg-surface outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus data-[state=checked]:border-teal data-[state=checked]:bg-teal data-[disabled]:opacity-50"
      >
        <RadixCheckbox.Indicator className="text-on-teal">
          <Icon name="check" size="sm" weight="bold" />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <div>
        <label htmlFor={id} className="text-body text-ink">
          {label}
        </label>
        {hint && <p className="text-secondary text-ink-muted">{hint}</p>}
      </div>
    </div>
  )
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Required: a switch without a name cannot be used with a screen reader. */
  label: string
  disabled?: boolean
}) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-6 w-11 shrink-0 rounded-full bg-line-strong outline-offset-2 transition-colors focus-visible:outline-2 focus-visible:outline-focus data-[state=checked]:bg-teal data-[disabled]:opacity-50"
    >
      <RadixSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-surface transition-transform data-[state=checked]:translate-x-[22px]" />
    </RadixSwitch.Root>
  )
}

export interface RadioOption<V extends string> {
  value: V
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

export function RadioCards<V extends string>({
  value,
  onValueChange,
  options,
  label,
  disabled,
}: {
  value: V
  onValueChange: (value: V) => void
  options: readonly RadioOption<V>[]
  label: string
  disabled?: boolean
}) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => onValueChange(next as V)}
      aria-label={label}
      disabled={disabled}
      className="flex flex-col gap-2"
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className="flex items-start gap-3 rounded-control border border-line bg-surface p-4 text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus data-[disabled]:opacity-50 data-[state=checked]:border-teal data-[state=checked]:bg-teal-soft"
        >
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface">
            <RadioGroup.Indicator className="size-2.5 rounded-full bg-teal" />
          </span>
          <span>
            <span className="block text-body-strong text-ink">{option.label}</span>
            {option.description && (
              <span className="block text-secondary text-ink-muted">{option.description}</span>
            )}
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}

/** `Chip` (DOC-54 §7.2): a toggle button; `aria-pressed` carries the state. */
export function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'h-control-sm rounded-full border px-4 text-label outline-offset-2 transition-colors focus-visible:outline-2 focus-visible:outline-focus',
        selected
          ? 'border-teal bg-teal-soft text-on-teal-soft'
          : 'border-line-strong bg-surface text-ink hover:bg-fill',
      )}
    >
      {children}
    </button>
  )
}

/** A labelled set of chips: a `fieldset`, so a screen reader announces the group name (UX-13). */
export function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      {children}
    </fieldset>
  )
}
