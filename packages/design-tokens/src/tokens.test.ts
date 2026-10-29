import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import * as native from '../generated/native'
import hien from '../tokens.json' with { type: 'json' }
import density from '../web.json' with { type: 'json' }
import { OUTPUTS } from './generate'
import { colors, shadows } from './model'

const root = join(import.meta.dir, '..')
const generated = (file: string) => readFileSync(join(root, 'generated', file), 'utf8')

/** The custom properties of every rule of a stylesheet, by selector (nested `@media` rules keep their selector). */
function cssBlocks(css: string): Map<string, Map<string, string>> {
  const blocks = new Map<string, Map<string, string>>()
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const selector = m[1]!.trim().replace(/\s+/g, ' ')
    const vars = new Map<string, string>()
    for (const d of m[2]!.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars.set(d[1]!, d[2]!.trim())
    blocks.set(selector, vars)
  }
  return blocks
}

const css = cssBlocks(generated('tokens.css'))
const light = css.get(':root, [data-theme="light"]')!
const dark = css.get('[data-theme="dark"]')!
const followsOs = css.get(':root:not([data-theme="light"])')!
const scales = css.get(':root')!

test('generated/ is what tokens.json renders today (run bun run tokens:build after an edit)', () => {
  for (const [file, render] of Object.entries(OUTPUTS))
    expect({ file, content: generated(file) }).toEqual({ file, content: render() })
})

describe('DS-01: tokens.json and tokens.css hold the same values', () => {
  const over: Record<string, Partial<Record<'light' | 'dark', string>>> = {
    ...density.theme.color,
    ...density.theme.shadow,
  }
  /** The value of a token in a theme as the web draws it: `web.json` `theme` over the canvas, aliases followed (DR-311). */
  const raw = (theme: 'light' | 'dark', value: string): string => {
    const alias = /^\{(.+)\}$/.exec(value)?.[1]
    if (!alias) return value
    return raw(
      theme,
      over[alias]?.[theme] ?? hien.color.tokens.find((t) => t.name === alias)!.value[theme],
    )
  }
  const webValue = (
    theme: 'light' | 'dark',
    t: { name: string; value: Record<'light' | 'dark', string> },
  ) => raw(theme, over[t.name]?.[theme] ?? t.value[theme])

  test('the 43 colors, the shadows and the web additions, in both themes, with the web theme over them', () => {
    expect(hien.color.tokens).toHaveLength(43)
    for (const t of [
      ...hien.color.tokens,
      ...hien.shadow.tokens,
      ...density.color,
      ...density.shadow,
    ]) {
      expect([t.name, light.get(t.name)]).toEqual([t.name, webValue('light', t)])
      expect([t.name, dark.get(t.name)]).toEqual([t.name, webValue('dark', t)])
    }
  })

  test('the web theme names only tokens that exist', () => {
    const names = new Set([...hien.color.tokens, ...hien.shadow.tokens].map((t) => t.name))
    for (const name of Object.keys(over)) expect([name, names.has(name)]).toEqual([name, true])
  })

  test('the operating-system dark block equals the explicit dark theme', () => {
    expect(followsOs).toEqual(dark)
    expect([...light.keys()]).toEqual([...dark.keys()])
  })

  test('spacing, radius, size and type, at the web density of web.json (DR-307)', () => {
    const over: Record<string, string> = { ...density.radius, ...density.size }
    for (const t of [...hien.spacing.tokens, ...hien.radius.tokens, ...hien.size.tokens])
      expect([t.name, scales.get(t.name)]).toEqual([t.name, over[t.name] ?? t.value])
    const typeOver: Record<
      string,
      Partial<(typeof hien.type.groups)[number]['styles'][number]>
    > = density.type
    for (const canvas of hien.type.groups.flatMap((g) => g.styles)) {
      const s = { ...canvas, letterSpacing: undefined, ...typeOver[canvas.name] }
      expect(scales.get(`text-${s.name}-size`)).toBe(s.fontSize)
      expect(scales.get(`text-${s.name}-line-height`)).toBe(s.lineHeight)
      expect(scales.get(`text-${s.name}-weight`)).toBe(String(s.fontWeight))
      expect(scales.get(`text-${s.name}-tracking`)).toBe(
        `${Number.parseFloat(s.letterSpacing || '0')}em`,
      )
    }
    expect(scales.get('font-sans')).toBe(hien.type.families.sans)
    expect(scales.get('font-plate')).toBe(hien.type.families.plate)
  })

  test('a hex value appears in tokens.css only, never in theme.css', () => {
    expect(generated('theme.css')).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
})

describe('DS-03: the native outputs match the canvas', () => {
  /** The apps draw the canvas: the variables of tokens.css without the web theme (DR-311). */
  const canvas = (theme: 'light' | 'dark') =>
    new Map([...colors, ...shadows].map((t) => [t.name, t.value[theme]]))

  test('native.ts has the keys of tokens.css and the canvas values of each theme', () => {
    expect([...Object.keys(native.themes.light)]).toEqual([...light.keys()])
    expect(new Map<string, string>(Object.entries(native.themes.light))).toEqual(canvas('light'))
    expect(new Map<string, string>(Object.entries(native.themes.dark))).toEqual(canvas('dark'))
  })

  test('the NativeWind preset defines only colors the CSS has, with the canvas values', () => {
    const preset = createRequire(import.meta.url)('../generated/tailwind-preset.cjs')
    const added: Record<string, unknown>[] = []
    preset.plugins[0]({ addBase: (base: Record<string, unknown>) => added.push(base) })
    const base = added[0] as Record<string, Record<string, string>>
    const darkBase = (
      base['@media (prefers-color-scheme: dark)'] as unknown as Record<
        string,
        Record<string, string>
      >
    )[':root']!
    for (const [name, value] of Object.entries(preset.theme.colors as Record<string, string>)) {
      if (name === 'transparent' || name === 'current') continue
      expect(value).toBe(`var(--${name})`)
      expect(light.has(name)).toBe(true)
      expect([name, base[':root']![`--${name}`]]).toEqual([name, canvas('light').get(name)])
      expect([name, darkBase[`--${name}`]]).toEqual([name, canvas('dark').get(name)])
    }
  })

  test('native text styles are dp, with the font file of their weight', () => {
    expect(native.textStyles.display).toEqual({
      fontFamily: 'Geologica-Bold',
      fontSize: 34,
      lineHeight: 40,
      letterSpacing: -0.68,
      fontWeight: '700',
    })
    expect(native.textStyles['plate-xl'].fontFamily).toBe('BigShoulders-ExtraBold')
    expect(native.space['space-4']).toBe(16)
  })
})
