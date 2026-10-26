import type { IconName } from '@rms/design-tokens'
import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { Icon } from './icon'
import { Spinner } from './spinner'
import { Text } from './text'

const VARIANT = {
  primary: { box: 'bg-teal active:bg-teal-pressed', text: 'on-teal', icon: 'on-teal' },
  tonal: { box: 'bg-teal-soft active:bg-fill', text: 'teal', icon: 'on-teal-soft' },
  outline: { box: 'border border-line-strong bg-surface active:bg-fill', text: 'ink', icon: 'ink' },
  ghost: { box: 'bg-transparent active:bg-fill', text: 'teal', icon: 'teal' },
  danger: { box: 'bg-danger active:opacity-80', text: 'on-danger', icon: 'on-danger' },
} as const

const SIZE = { sm: 'h-control-sm px-4', md: 'h-control-md px-5', lg: 'h-control-lg px-6' } as const

export interface ButtonProps {
  children: ReactNode
  onPress?: () => void
  variant?: keyof typeof VARIANT
  size?: keyof typeof SIZE
  icon?: IconName
  /** Spinner in place of the label; the button stays disabled and keeps its size (UX-01: one request per tap). */
  loading?: boolean
  disabled?: boolean
  block?: boolean
  testID?: string
  accessibilityLabel?: string
}

/** Fully round, 44 or 52 dp high (DOC-54 §7.1); `sm` extends its hit area with `hitSlop` (A1). */
export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  loading,
  disabled,
  block,
  testID,
  accessibilityLabel,
}: ButtonProps) {
  const style = VARIANT[variant]
  const off = disabled || loading
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      hitSlop={size === 'sm' ? 6 : 0}
      className={`flex-row items-center justify-center gap-2 rounded-full ${SIZE[size]} ${style.box} ${block ? 'w-full' : 'self-start'} ${off ? 'opacity-50' : ''}`}
    >
      {loading ? (
        <Spinner color={style.icon} />
      ) : (
        <View className="flex-row items-center gap-2">
          {icon ? <Icon name={icon} size="sm" color={style.icon} /> : null}
          <Text variant="body-strong" tone={style.text}>
            {children}
          </Text>
        </View>
      )}
    </Pressable>
  )
}

export interface IconButtonProps {
  icon: IconName
  /** Required: an icon-only control has an accessible name (A5), checked by the type. */
  label: string
  onPress?: () => void
  disabled?: boolean
  testID?: string
}

export function IconButton({ icon, label, onPress, disabled, testID }: IconButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      className={`h-tap-min w-tap-min items-center justify-center rounded-full active:bg-fill ${disabled ? 'opacity-50' : ''}`}
    >
      <Icon name={icon} />
    </Pressable>
  )
}
