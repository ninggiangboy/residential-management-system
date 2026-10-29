import {
  colors,
  families,
  fonts,
  nativeFont,
  radius,
  type Scale,
  shadows,
  sizes,
  spacing,
  type Theme,
  textStyles,
  web,
} from './model'

/**
 * Renders the outputs of DOC-54 §2.1 from `tokens.json`. Pure: `scripts/build.ts` writes them to `generated/`, and
 * the test "generated files are current" renders them again and compares. DR-229 decides the two Tailwind targets:
 * Tailwind 4 (`theme.css`) for the web, Tailwind 3 with NativeWind (`tailwind-preset.cjs`) for the apps.
 */
const HEADER = 'Generated from tokens.json (Hiên v1) by `bun run tokens:build`. Do not edit.'

/** The colors and shadows of a theme: the canvas values for the apps, the web's (`web.json` `theme`, DR-311) for `tokens.css`. */
const themed = (theme: Theme, target: 'canvas' | 'web' = 'canvas') => [
  ...(target === 'web' ? web.colors : colors).map((c) => [c.name, c.value[theme]] as const),
  ...(target === 'web' ? web.shadows : shadows).map((s) => [s.name, s.value[theme]] as const),
]

const block = (selector: string, entries: readonly (readonly [string, string])[], indent = '') =>
  [
    `${indent}${selector} {`,
    ...entries.map(([k, v]) => `${indent}  --${k}: ${v};`),
    `${indent}}`,
  ].join('\n')

const scaleEntries = (scale: readonly Scale[]) => scale.map((s) => [s.name, `${s.px}px`] as const)

/**
 * The canvas variable names (`--ground`, `--space-4`, `--radius-card`…), light and dark (DOC-54 §2.1); type, radius and
 * sizes at the web density (DR-307), colors and shadows in the web theme (DR-311).
 */
function tokensCss(): string {
  const text = web.textStyles.flatMap((s) => [
    [`text-${s.name}-size`, `${s.fontSize}px`] as const,
    [`text-${s.name}-line-height`, `${s.lineHeight}px`] as const,
    [`text-${s.name}-weight`, String(s.fontWeight)] as const,
    [`text-${s.name}-tracking`, `${s.letterSpacing}em`] as const,
  ])
  return [
    `/* ${HEADER} */`,
    '',
    '/* The light theme is the default; `data-theme` on the root picks one explicitly. */',
    block(':root,\n[data-theme="light"]', themed('light', 'web')),
    '',
    block('[data-theme="dark"]', themed('dark', 'web')),
    '',
    '/* Follows the operating system until a script sets `data-theme` (DR-182). */',
    '@media (prefers-color-scheme: dark) {',
    block(':root:not([data-theme="light"])', themed('dark', 'web'), '  '),
    '}',
    '',
    block(':root', [
      ...scaleEntries(spacing),
      ...scaleEntries(web.radius),
      ...scaleEntries(web.sizes),
      ['font-sans', families.sans],
      ['font-plate', families.plate],
      ...text,
    ]),
    '',
  ].join('\n')
}

/**
 * Tailwind 4 theme for the web: colors read the variables, so a theme switch changes no class (DOC-54 §2.1). Type, radius
 * and sizes are the web density (DR-307).
 */
function themeCss(): string {
  const lines = [
    `/* ${HEADER} */`,
    '/* Only token utilities exist: the default palette, shadows, radii, type sizes and fonts are removed. */',
    '',
    '@theme inline {',
    '  --color-*: initial;',
    ...colors.map((c) => `  --color-${c.name}: var(--${c.name});`),
    '}',
    '',
    '@theme {',
    '  --shadow-*: initial;',
    '  --inset-shadow-*: initial;',
    '  --drop-shadow-*: initial;',
    '  --radius-*: initial;',
    ...web.radius.map((r) => `  --radius-${r.name.replace(/^radius-/, '')}: ${r.px}px;`),
    '  --font-*: initial;',
    `  --font-sans: ${families.sans};`,
    `  --font-plate: ${families.plate};`,
    '  --text-*: initial;',
    ...web.textStyles.flatMap((s) => [
      `  --text-${s.name}: ${s.fontSize}px;`,
      `  --text-${s.name}--line-height: ${s.lineHeight}px;`,
      `  --text-${s.name}--font-weight: ${s.fontWeight};`,
      `  --text-${s.name}--letter-spacing: ${s.letterSpacing}em;`,
    ]),
    ...web.sizes.map((s) => `  --spacing-${s.name}: ${s.px}px;`),
    '}',
    '',
    '/* Shadows change with the theme, so they read the variables of tokens.css directly. */',
    ...shadows.map((s) => `@utility ${s.name} {\n  box-shadow: var(--${s.name});\n}`),
    '',
  ]
  return lines.join('\n')
}

/** Self-hosted faces for the web (`apps/cms-web/public/fonts`, DR-180). */
function fontsCss(): string {
  return [
    `/* ${HEADER} */`,
    '',
    ...fonts.map((f) =>
      [
        '@font-face {',
        `  font-family: "${f.cssFamily}";`,
        `  src: url("/fonts/${f.file}.woff2") format("woff2");`,
        `  font-weight: ${f.weight};`,
        '  font-style: normal;',
        '  font-display: swap;',
        '}',
      ].join('\n'),
    ),
    '',
  ].join('\n')
}

/** Tailwind's spacing steps (`p-4` = 16) written in px, so the apps measure like the web whatever NativeWind's rem is. */
const SPACING_STEPS = [
  0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44,
  48, 52, 56, 60, 64, 72, 80, 96,
]

const js = (value: unknown) => JSON.stringify(value, null, 2)
const dp = (style: (typeof textStyles)[number]) =>
  Math.round(style.letterSpacing * style.fontSize * 100) / 100

/**
 * Tailwind 3 preset for NativeWind (DR-229). Colors read CSS variables that NativeWind turns into light and dark
 * root variables, so the apps follow the system theme with no class change. Shadows are not here: NativeWind 4.2
 * drops `box-shadow: var(…)`; `native.ts` holds them for the `boxShadow` style (P1-17).
 */
function tailwindPreset(): string {
  const vars = (theme: Theme) =>
    Object.fromEntries(colors.map((c) => [`--${c.name}`, c.value[theme]]))
  const fontFamily = Object.fromEntries(
    fonts.map((f) => [
      f.file
        .replace(/^Geologica-/, 'sans-')
        .replace(/^BigShoulders-/, 'plate-')
        .toLowerCase(),
      [f.file],
    ]),
  )
  const preset = {
    theme: {
      colors: {
        transparent: 'transparent',
        current: 'currentColor',
        ...Object.fromEntries(colors.map((c) => [c.name, `var(--${c.name})`])),
      },
      fontFamily: {
        sans: [nativeFont('sans', 400)],
        plate: [nativeFont('plate', 700)],
        ...fontFamily,
      },
      fontSize: Object.fromEntries(
        textStyles.map((s) => [
          s.name,
          [
            `${s.fontSize}px`,
            {
              lineHeight: `${s.lineHeight}px`,
              letterSpacing: `${dp(s)}px`,
              fontWeight: String(s.fontWeight),
            },
          ],
        ]),
      ),
      borderRadius: {
        none: '0px',
        ...Object.fromEntries(radius.map((r) => [r.name.replace(/^radius-/, ''), `${r.px}px`])),
      },
      spacing: {
        px: '1px',
        ...Object.fromEntries(SPACING_STEPS.map((step) => [String(step), `${step * 4}px`])),
        ...Object.fromEntries(sizes.map((s) => [s.name, `${s.px}px`])),
      },
    },
  }
  return [
    `// ${HEADER}`,
    `const preset = ${js(preset)}`,
    '',
    `const light = ${js(vars('light'))}`,
    '',
    `const dark = ${js(vars('dark'))}`,
    '',
    '/** The variables live in the preset, so `global.css` needs only the three `@tailwind` lines. */',
    'preset.plugins = [',
    "  ({ addBase }) => addBase({ ':root': light, '@media (prefers-color-scheme: dark)': { ':root': dark } }),",
    ']',
    '',
    'module.exports = preset',
    '',
  ].join('\n')
}

/** Resolved values for `@rms/ui-native` and the `StyleSheet` fallback (ADR-0019). Numbers are dp. */
function nativeTs(): string {
  const theme = (t: Theme) => Object.fromEntries(themed(t))
  const scale = (s: readonly Scale[]) => Object.fromEntries(s.map((x) => [x.name, x.px]))
  const text = Object.fromEntries(
    textStyles.map((s) => [
      s.name,
      {
        fontFamily: nativeFont(s.family, s.fontWeight),
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        letterSpacing: dp(s),
        fontWeight: String(s.fontWeight),
      },
    ]),
  )
  return [
    `// ${HEADER}`,
    '',
    '/** Colors and shadows per theme, by the canvas names. Shadows are CSS strings for the `boxShadow` style. */',
    `export const themes = ${js({ light: theme('light'), dark: theme('dark') })} as const`,
    '',
    `export const space = ${js(scale(spacing))} as const`,
    '',
    `export const radius = ${js(scale(radius))} as const`,
    '',
    `export const size = ${js(scale(sizes))} as const`,
    '',
    '/** `fontFamily` names the static file (and PostScript name) of the weight: React Native picks fonts by name. */',
    `export const textStyles = ${js(text)} as const`,
    '',
    `export const fontFiles = ${js(fonts.map((f) => f.file))} as const`,
    '',
  ].join('\n')
}

export const OUTPUTS: Readonly<Record<string, () => string>> = {
  'tokens.css': tokensCss,
  'theme.css': themeCss,
  'fonts.css': fontsCss,
  'tailwind-preset.cjs': tailwindPreset,
  'native.ts': nativeTs,
}
