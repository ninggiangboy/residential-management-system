import type { IconName } from '@rms/design-tokens'
import { type ReactNode, useState } from 'react'
import { Pressable, TextInput, type TextInputProps, View } from 'react-native'
import { Icon } from './icon'
import { Text } from './text'
import { useTheme } from './theme'

export interface TextFieldProps
  extends Omit<TextInputProps, 'style' | 'className' | 'placeholderTextColor'> {
  label: string
  /** Help text under the field; replaced by the error when there is one. */
  hint?: string
  /** An error is text plus the `danger` ring, never the ring alone (A8). */
  error?: string
  icon?: IconName
  /** A short control at the end of the field: "Hiện" / "Ẩn" of a password. */
  suffix?: { label: string; onPress: () => void; accessibilityLabel?: string }
  testID?: string
  footer?: ReactNode
}

/** A visible label, the field, then help or error text tied to it (A8, DOC-54 §12). */
export function TextField({
  label,
  hint,
  error,
  icon,
  suffix,
  testID,
  footer,
  ...input
}: TextFieldProps) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  const ring = error ? 'border-danger' : focused ? 'border-teal' : 'border-line-strong'
  return (
    <View className="gap-2">
      <Text variant="label">{label}</Text>
      <View
        className={`h-control-lg flex-row items-center gap-3 rounded-control border bg-surface px-4 ${ring} ${focused || error ? 'border-2' : ''}`}
      >
        {icon ? <Icon name={icon} size="sm" color="ink-muted" /> : null}
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          placeholderTextColor={colors['ink-disabled']}
          selectionColor={colors.teal}
          onFocus={(event) => {
            setFocused(true)
            input.onFocus?.(event)
          }}
          onBlur={(event) => {
            setFocused(false)
            input.onBlur?.(event)
          }}
          className="font-sans-regular flex-1 py-0 text-body text-ink"
          {...input}
        />
        {suffix ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={suffix.accessibilityLabel ?? suffix.label}
            onPress={suffix.onPress}
            hitSlop={8}
          >
            <Text variant="label" tone="teal">
              {suffix.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text
          variant="secondary"
          tone="danger"
          accessibilityRole="alert"
          testID={testID ? `${testID}-error` : undefined}
        >
          {error}
        </Text>
      ) : hint ? (
        <Text variant="secondary" tone="muted">
          {hint}
        </Text>
      ) : null}
      {footer}
    </View>
  )
}
