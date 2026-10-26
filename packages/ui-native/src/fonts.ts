/**
 * The static `ttf` files of the design system, keyed by their PostScript names: React Native picks a font by name, so these are
 * the keys `useFonts` of `expo-font` registers, and the families of the Tailwind preset (`font-sans-semibold`) match them
 * (DOC-54 §4.1, DR-180). The app loads them before the splash screen hides.
 */
export const FONT_SOURCES = {
  'Geologica-Regular': require('@rms/design-tokens/fonts/Geologica-Regular.ttf'),
  'Geologica-Medium': require('@rms/design-tokens/fonts/Geologica-Medium.ttf'),
  'Geologica-SemiBold': require('@rms/design-tokens/fonts/Geologica-SemiBold.ttf'),
  'Geologica-Bold': require('@rms/design-tokens/fonts/Geologica-Bold.ttf'),
  'BigShoulders-Bold': require('@rms/design-tokens/fonts/BigShoulders-Bold.ttf'),
  'BigShoulders-ExtraBold': require('@rms/design-tokens/fonts/BigShoulders-ExtraBold.ttf'),
} as const
