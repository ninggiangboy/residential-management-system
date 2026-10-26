import { Text as RNText, type TextProps as RNTextProps } from 'react-native'

const VARIANTS = {
  display: 'font-sans-bold text-display',
  'title-1': 'font-sans-semibold text-title-1',
  'title-2': 'font-sans-semibold text-title-2',
  'title-3': 'font-sans-semibold text-title-3',
  body: 'font-sans-regular text-body',
  'body-strong': 'font-sans-semibold text-body-strong',
  label: 'font-sans-medium text-label',
  secondary: 'font-sans-regular text-secondary',
  caption: 'font-sans-regular text-caption',
  micro: 'font-sans-medium text-micro',
} as const

const TONES = {
  ink: 'text-ink',
  muted: 'text-ink-muted',
  disabled: 'text-ink-disabled',
  teal: 'text-teal',
  danger: 'text-danger',
  'on-teal': 'text-on-teal',
  'on-danger': 'text-on-danger',
  'on-plate': 'text-on-plate',
} as const

export interface TextProps extends RNTextProps {
  variant?: keyof typeof VARIANTS
  tone?: keyof typeof TONES
  className?: string
}

/** Text in the type scale of the design system: a variant picks the size, the weight file and the line height (DOC-54 §4). */
export function Text({ variant = 'body', tone = 'ink', className, ...props }: TextProps) {
  return <RNText className={`${VARIANTS[variant]} ${TONES[tone]} ${className ?? ''}`} {...props} />
}
