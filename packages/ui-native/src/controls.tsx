import { Pressable, Switch as RNSwitch, View } from 'react-native'
import { Icon } from './icon'
import { Text } from './text'
import { useTheme } from './theme'

export function Switch({
  value,
  onValueChange,
  label,
  disabled,
  testID,
}: {
  value: boolean
  onValueChange: (next: boolean) => void
  /** The accessible name of the switch: its row's title. */
  label: string
  disabled?: boolean
  testID?: string
}) {
  const { colors } = useTheme()
  return (
    <RNSwitch
      testID={testID}
      accessibilityLabel={label}
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: colors['line-strong'], true: colors.teal }}
      thumbColor={colors.surface}
    />
  )
}

/** A near-square box (8 dp) with its label; the hit area is the whole row (A1). */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  testID,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  testID?: string
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      className="min-h-tap-min flex-row items-center gap-3"
    >
      <View
        className={`h-6 w-6 items-center justify-center rounded-plate border-2 ${checked ? 'border-teal bg-teal' : 'border-line-strong bg-surface'}`}
      >
        {checked ? <Icon name="check" size="sm" color="on-teal" weight="bold" /> : null}
      </View>
      <Text variant="body" className="flex-1">
        {label}
      </Text>
    </Pressable>
  )
}
