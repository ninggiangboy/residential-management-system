import { ActivityIndicator } from 'react-native'
import { type ColorName, useTheme } from './theme'

export function Spinner({ color = 'teal' }: { color?: ColorName }) {
  const { colors } = useTheme()
  return <ActivityIndicator color={colors[color]} />
}
