import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import * as native from '../generated/native'
import hien from '../tokens.json' with { type: 'json' }
import density from '../web.json' with { type: 'json' }
import { OUTPUTS } from './generate'

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
  const raw = (theme: 'light' | 'dark', value: string): string => {
    const alias = /^\{(.+)\}$/.exec(value)?.[1]
    return alias ? raw(theme, hien.color.tokens.find((t) => t.name === alias)!.value[theme]) : value
  }

  test('the 43 colors, the shadows and the web additions, in both themes', () => {
    expect(hien.color.tokens).toHaveLength(43)
    for (const t of [
      ...hien.color.tokens,
      ...hien.shadow.tokens,
      ...density.color,
      ...density.shadow,
    ]) {
      expect([t.name, light.get(t.name)]).toEqual([t.name, raw('light', t.value.light)])
      expect([t.name, dark.get(t.name)]).toEqual([t.name, raw('dark', t.value.dark)])
    }
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

describe('DS-03: the native outputs match tokens.css', () => {
  test('native.ts has the keys and resolved values of each theme', () => {
    expect(new Map<string, string>(Object.entries(native.themes.light))).toEqual(light)
    expect(new Map<string, string>(Object.entries(native.themes.dark))).toEqual(dark)
  })

  test('the NativeWind preset defines only colors the CSS has, with the same values', () => {
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
      expect([name, base[':root']![`--${name}`]]).toEqual([name, light.get(name)])
      expect([name, darkBase[`--${name}`]]).toEqual([name, dark.get(name)])
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
