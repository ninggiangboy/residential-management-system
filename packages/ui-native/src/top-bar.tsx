import type { ReactNode } from 'react'
import { View } from 'react-native'
import { IconButton } from './button'
import { Text } from './text'

export interface TopBarProps {
  title: string
  /** The large variant (`title-1` with a subtitle) is for the root of a flow (DOC-54 §8.2). */
  large?: boolean
  subtitle?: string
  /** The accessible name of the back button; absent means no back button. */
  backLabel?: string
  onBack?: () => void
  right?: ReactNode
}

export function TopBar({ title, large, subtitle, backLabel, onBack, right }: TopBarProps) {
  return (
    <View className={`px-gutter ${large ? 'pb-2 pt-2' : 'h-topbar-height justify-center'}`}>
      <View className="flex-row items-center gap-2">
        {backLabel && onBack ? (
          <View className="-ml-3">
            <IconButton icon="caret-left" label={backLabel} onPress={onBack} />
          </View>
        ) : null}
        {large ? null : (
          <Text variant="title-3" className="flex-1" numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        )}
        {large ? <View className="flex-1" /> : null}
        {right}
      </View>
      {large ? (
        <View className="gap-1 pt-2">
          <Text variant="title-1" accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text variant="body" tone="muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}
