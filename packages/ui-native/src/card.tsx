import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { Text } from './text'
import { useTheme } from './theme'

export interface CardProps {
  children: ReactNode
  onPress?: () => void
  accessibilityLabel?: string
  testID?: string
  selected?: boolean
}

/**
 * A `surface` rising from the ground: `shadow-card` in the light theme, a 1 px `line` outline in the dark one (DOC-54 §2.2 rule 1).
 * The shadow is the token's CSS string on the `boxShadow` style (DOC-54 §2.1).
 */
export function Card({ children, onPress, accessibilityLabel, testID, selected }: CardProps) {
  const { name, colors } = useTheme()
  const box = `rounded-card bg-surface p-5 ${name === 'dark' ? 'border border-line' : ''} ${selected ? 'border-2 border-teal' : ''}`
  const style = name === 'light' ? { boxShadow: colors['shadow-card'] } : undefined
  if (!onPress)
    return (
      <View testID={testID} className={box} style={style}>
        {children}
      </View>
    )
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className={`${box} active:bg-fill`}
      style={style}
    >
      {children}
    </Pressable>
  )
}

/** Identifiers are plates: a unit code, a ticket code, a vehicle plate (DOC-54 §2.2 rule 4). */
export function Plate({
  children,
  size = 'md',
}: {
  children: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const text = {
    sm: 'text-plate-sm',
    md: 'text-plate-md',
    lg: 'text-plate-lg',
    xl: 'text-plate-xl',
  }[size]
  return (
    <View className="self-start rounded-plate bg-plate px-3 py-1">
      <Text variant="body" tone="on-plate" className={`font-plate-bold ${text}`}>
        {children}
      </Text>
    </View>
  )
}
