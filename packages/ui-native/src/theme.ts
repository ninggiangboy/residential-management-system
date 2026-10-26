import { themes } from '@rms/design-tokens/native'
import { useColorScheme } from 'react-native'

export { fontFiles, radius, size, space, textStyles, themes } from '@rms/design-tokens/native'

export type ThemeName = keyof typeof themes
export type ColorName = keyof (typeof themes)['light']
export type ThemeColors = Record<ColorName, string>

/**
 * The resolved colors of the theme the operating system picked (DOC-54 §11, DR-182): no stored preference, no toggle. A class
 * name carries a color wherever it can; this is for the places a raw value is needed (an icon, a placeholder, a switch track).
 */
export function useTheme(): { name: ThemeName; colors: ThemeColors } {
  const name: ThemeName = useColorScheme() === 'dark' ? 'dark' : 'light'
  return { name, colors: themes[name] as ThemeColors }
}
