import { type ComponentRef, useEffect, useRef } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Text } from './text'
import { useTheme } from './theme'

export interface OtpInputProps {
  value: string
  onChange: (value: string) => void
  /** Called once when the last digit arrives (UIRA-13: the caller sends exactly one verify). */
  onComplete: (value: string) => void
  length?: number
  disabled?: boolean
  /** The group is announced once as this (A7): "Mã xác thực, 6 chữ số". */
  label: string
  error?: string
  autoFocus?: boolean
  testID?: string
}

/**
 * Six cells over one real input (DOC-54 §7.2, A7): numeric keyboard, `textContentType="oneTimeCode"` and `autoComplete="sms-otp"`
 * so the SMS code can be filled in. `onComplete` fires when the value reaches `length` through a change, never twice for the
 * same value.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled,
  label,
  error,
  autoFocus,
  testID,
}: OtpInputProps) {
  const { colors } = useTheme()
  const input = useRef<ComponentRef<typeof TextInput>>(null)
  const completed = useRef<string | null>(null)

  // The caller clears the value after a wrong code; the same code typed again must complete again.
  useEffect(() => {
    if (value.length < length) completed.current = null
  }, [value, length])

  const change = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, length)
    onChange(digits)
    if (digits.length === length && completed.current !== digits) {
      completed.current = digits
      onComplete(digits)
    }
    if (digits.length < length) completed.current = null
  }

  return (
    <View className="gap-2">
      <Pressable
        accessible
        accessibilityLabel={label}
        accessibilityRole="none"
        onPress={() => input.current?.focus()}
        className="flex-row justify-between gap-2"
      >
        {Array.from({ length }, (_, i) => {
          const key = `cell-${i}`
          const filled = i < value.length
          const active = !disabled && i === Math.min(value.length, length - 1)
          return (
            <View
              key={key}
              className={`h-control-lg flex-1 items-center justify-center rounded-control border bg-surface ${
                error
                  ? 'border-2 border-danger'
                  : active
                    ? 'border-2 border-teal'
                    : 'border-line-strong'
              }`}
            >
              <Text variant="title-2">{filled ? value[i] : ''}</Text>
            </View>
          )
        })}
      </Pressable>
      <TextInput
        ref={input}
        testID={testID}
        value={value}
        onChangeText={change}
        editable={!disabled}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        caretHidden
        accessibilityLabel={label}
        selectionColor={colors.teal}
        // The real input sits under the cells: it takes the focus and the keyboard, and shows nothing.
        style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
      />
      {error ? (
        <Text
          variant="secondary"
          tone="danger"
          accessibilityRole="alert"
          testID={testID ? `${testID}-error` : undefined}
        >
          {error}
        </Text>
      ) : null}
    </View>
  )
}
