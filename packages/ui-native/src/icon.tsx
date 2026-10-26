import type { IconName } from '@rms/design-tokens'
import { ICONS } from './icons'
import { type ColorName, useTheme } from './theme'

const SIZES = { sm: 20, md: 24, lg: 32 } as const

export interface IconProps {
  name: IconName
  size?: keyof typeof SIZES
  /** A color token name (`ink`, `teal`, `danger`…). */
  color?: ColorName
  weight?: 'regular' | 'fill' | 'bold'
  /** An icon that conveys meaning has an accessible name; a decorative one is hidden from assistive technology (DOC-54 §7.3). */
  label?: string
}

export function Icon({ name, size = 'md', color = 'ink', weight = 'regular', label }: IconProps) {
  const { colors } = useTheme()
  const Glyph = ICONS[name]
  return (
    <Glyph
      size={SIZES[size]}
      color={colors[color]}
      weight={weight}
      {...(label
        ? { accessibilityLabel: label, accessible: true }
        : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' })}
    />
  )
}
