import { describe, expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { compile } from '@tailwindcss/node'
import postcss from 'postcss'
import { cssToReactNativeRuntime } from 'react-native-css-interop/css-to-rn'
import tailwind3 from 'tailwindcss'
import * as native from '../../packages/design-tokens/generated/native'

/**
 * DOC-11 §10 rows 7 and 8 with the tokens of P1-09: the web compiles `theme.css` with Tailwind 4, and the apps
 * compile the preset with Tailwind 3 and NativeWind into light and dark root variables (DR-229). The tests of
 * `@rms/design-tokens` compare the files; these compile them with the pinned tools.
 */
const root = join(import.meta.dir, '../..')
const require = createRequire(import.meta.url)

describe('web: Tailwind 4 with theme.css', async () => {
  const css = `@import "tailwindcss";
@import "@rms/design-tokens/tokens.css";
@import "@rms/design-tokens/theme.css";`
  const compiler = await compile(css, {
    base: join(root, 'apps/cms-web/src'),
    onDependency: () => {},
  })
  const build = (classes: string[]) => compiler.build(classes)

  test('token utilities read the canvas variables', () => {
    const out = build([
      'bg-ground',
      'text-ink',
      'rounded-card',
      'shadow-card',
      'text-title-1',
      'font-plate',
      'h-control-lg',
    ])
    expect(out).toContain('background-color: var(--ground)')
    expect(out).toContain('color: var(--ink)')
    expect(out).toContain('border-radius: var(--radius-card)')
    expect(out).toContain('box-shadow: var(--shadow-card)')
    expect(out).toContain('font-size: var(--text-title-1)')
    expect(out).toContain('.font-plate')
    expect(out).toContain('height: var(--spacing-control-lg)')
  })

  test('the default palette, shadows, radii and sizes are gone', () => {
    const out = build([
      'bg-red-500',
      'text-slate-900',
      'shadow-lg',
      'rounded-lg',
      'text-sm',
      'font-mono',
    ])
    for (const cls of [
      '.bg-red-500',
      '.text-slate-900',
      '.shadow-lg',
      '.rounded-lg',
      '.text-sm',
      '.font-mono',
    ])
      expect(out).not.toContain(cls)
  })
})

describe('apps: Tailwind 3, NativeWind and the preset', async () => {
  process.env.NATIVEWIND_OS = 'android'
  // NativeWind keeps only the variables a compiled utility reads, so every color is used once
  const colorNames = Object.keys(native.themes.light).filter((name) => !name.startsWith('shadow-'))
  const content = [
    'text-ink',
    'rounded-card',
    'text-display',
    'font-sans-bold',
    'p-4',
    'h-control-lg',
    ...colorNames.map((name) => `bg-${name}`),
  ]
  const result = await postcss([
    tailwind3({
      content: [{ raw: content.join(' '), extension: 'tsx' }],
      presets: [require('nativewind/preset'), require('@rms/design-tokens/tailwind-preset')],
    }),
  ]).process('@tailwind base;\n@tailwind components;\n@tailwind utilities;', { from: undefined })
  const runtime = cssToReactNativeRuntime(result.css) as unknown as {
    rootVariables: Record<string, { light: string; dark: string }>
    rules: Record<string, unknown>
  }

  /** Lightning CSS writes `rgba(15, 42, 43, 0.5)` as `#0f2a2b80`: the same color. */
  const hex = (color: string) => {
    const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(color)
    if (!m) return color.toLowerCase()
    const byte = (n: number) => Math.round(n).toString(16).padStart(2, '0')
    return `#${byte(+m[1]!)}${byte(+m[2]!)}${byte(+m[3]!)}${byte(+m[4]! * 255)}`
  }

  test('every color becomes a root variable with its light and dark value', () => {
    for (const name of colorNames) {
      const light = native.themes.light[name as keyof typeof native.themes.light]
      const dark = native.themes.dark[name as keyof typeof native.themes.dark]
      const variable = runtime.rootVariables[`--${name}`]
      expect([name, variable?.light, variable?.dark]).toEqual([name, hex(light), hex(dark)])
    }
  })

  test('the utilities of the screens compile to styles', () => {
    for (const cls of content) expect([cls, cls in runtime.rules]).toEqual([cls, true])
    expect(JSON.stringify(runtime.rules['text-display'])).toContain('"fontSize":34')
    expect(JSON.stringify(runtime.rules['p-4'])).toContain('16')
  })
})
