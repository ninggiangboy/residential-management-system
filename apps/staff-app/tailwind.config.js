/** @type {import('tailwindcss').Config} */
module.exports = {
  // The shared components carry their classes, so Tailwind scans them as well (DOC-54 §7.1).
  content: [
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    '../../packages/ui-native/src/**/*.{ts,tsx}',
  ],
  presets: [require('nativewind/preset'), require('@rms/design-tokens/tailwind-preset')],
}
