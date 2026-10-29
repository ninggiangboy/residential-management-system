import type { IconName } from '@rms/design-tokens'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, Ref } from 'react'
import { useDelayedFlag } from '../../lib/use-delayed-flag'
import { cn } from '../../lib/utils'
import { Icon } from './icon'

export const buttonStyles = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-control text-label outline-offset-2 transition-colors focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-fill disabled:text-ink-disabled disabled:border-transparent',
  {
    variants: {
      variant: {
        primary: 'bg-teal text-on-teal hover:bg-teal-pressed',
        // A button is named by its text, so its border is the light `line` (DR-307); the control border is for inputs.
        outline: 'border border-line bg-surface text-ink shadow-raised hover:bg-ground',
        ghost: 'text-ink hover:bg-fill',
        tonal: 'bg-teal-soft text-on-teal-soft hover:bg-fill',
        danger: 'bg-danger text-on-danger hover:opacity-90',
        'danger-ghost': 'text-danger hover:bg-danger-soft',
      },
      size: {
        sm: 'h-control-sm gap-1.5 px-3',
        md: 'h-control-md px-4',
        lg: 'h-control-lg px-5',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonStyles> {
  icon?: IconName
  /** The call is in flight: the button is disabled and shows a spinner (UX-01). */
  loading?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  className,
  variant,
  size,
  block,
  icon,
  loading,
  disabled,
  children,
  type = 'button',
  ref,
  ...props
}: ButtonProps) {
  // The button is disabled at once; the spinner shows only for a call that lasts over 150 ms, then for at least 400 ms, so a
  // fast answer does not flash it (DR-306). The spinner sits over the centre and the label turns transparent beneath it, so the
  // button keeps its width and the row around it does not move (DOC-54 §17).
  const spinning = useDelayedFlag(Boolean(loading))
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        buttonStyles({ variant, size, block }),
        'relative',
        spinning && 'disabled:text-transparent',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {icon && <Icon name={icon} size="sm" />}
      {children}
      {spinning && <Spinner />}
    </button>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-0 m-auto size-icon-sm animate-spin rounded-full border-2 border-ink-disabled border-t-transparent"
    />
  )
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName
  /** Required: an icon button without a name cannot be used with a screen reader (UX-13). */
  label: string
  variant?: 'ghost' | 'outline' | 'tonal'
  size?: 'sm' | 'md'
  ref?: Ref<HTMLButtonElement>
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  className,
  type = 'button',
  ref,
  ...props
}: IconButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        buttonStyles({ variant, size }),
        size === 'sm' ? 'w-control-sm px-0' : 'w-control-md px-0',
        // The touch area of the small control grows to 44 px (DR-184).
        size === 'sm' && 'relative after:absolute after:-inset-1 after:content-[""]',
        className,
      )}
      {...props}
    >
      <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} />
    </button>
  )
}
