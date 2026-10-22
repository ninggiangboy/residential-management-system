import { describe, expect, test } from 'bun:test'
import { contrast } from './contrast'
import { colors, type Theme } from './model'

/**
 * DS-02 (DOC-54 §3.2): the pairs the components use, with the ratios the document prints. A token edit that drops a
 * pair below its need fails; the three rows of §3.3 are the only allowed failures.
 */
const TEXT = 4.5
const MARK = 3
const pairs: [fg: string, bg: string, need: number, light: number, dark: number][] = [
  ['ink', 'ground', TEXT, 13.32, 16.29],
  ['ink', 'surface', TEXT, 15.15, 14.43],
  ['ink', 'fill', TEXT, 12.08, 12.65],
  ['ink-muted', 'ground', TEXT, 5.94, 8.93],
  ['ink-muted', 'surface', TEXT, 6.76, 7.91],
  ['ink-muted', 'fill', TEXT, 5.39, 6.93],
  ['teal', 'ground', TEXT, 5.58, 10.37],
  ['teal', 'surface', TEXT, 6.35, 9.18],
  ['on-teal', 'teal', TEXT, 6.35, 9.37],
  ['on-teal', 'teal-pressed', TEXT, 8.9, 11.4],
  ['on-teal-soft', 'teal-soft', TEXT, 7.15, 9.22],
  ['on-lamp', 'lamp', TEXT, 10.52, 10.52],
  ['on-lamp-soft', 'lamp-soft', TEXT, 7.83, 9.93],
  ['on-plate', 'plate', TEXT, 14.04, 13.22],
  ['danger', 'ground', TEXT, 5.75, 9.26],
  ['danger', 'surface', TEXT, 6.54, 8.2],
  ['on-danger', 'danger', TEXT, 6.54, 8.5],
  ['on-danger-soft', 'danger-soft', TEXT, 7.3, 9.34],
  ['info', 'ground', TEXT, 5.99, 9.61],
  ['info', 'surface', TEXT, 6.81, 8.52],
  ['on-info-soft', 'info-soft', TEXT, 7.76, 9.13],
  ['on-hero', 'hero-from', TEXT, 5.94, 5.63],
  ['on-hero', 'hero-to', TEXT, 13.26, 13.56],
  ['on-hero-muted', 'hero-from', TEXT, 4.65, 4.63],
  ['on-hero-muted', 'hero-to', TEXT, 10.38, 11.16],
  ['on-gold', 'gold-from', TEXT, 12.09, 12.09],
  ['on-gold', 'gold-to', TEXT, 9.22, 9.22],
  ['on-coral-soft', 'coral-soft', TEXT, 6.04, 8.46],
  ['on-violet-soft', 'violet-soft', TEXT, 7.09, 8.45],
  ['ink-disabled', 'surface', TEXT, 2.89, 2.99],
  ['line-strong', 'surface', MARK, 4.03, 4.14],
  ['line-strong', 'ground', MARK, 3.54, 4.67],
  ['line-strong', 'fill', MARK, 3.22, 3.63],
  ['focus', 'ground', MARK, 13.32, 11.83],
  ['focus', 'surface', MARK, 15.15, 10.47],
  ['focus', 'fill', MARK, 12.08, 9.18],
  ['lamp', 'surface', MARK, 1.58, 10.47],
  ['lamp', 'ground', MARK, 1.39, 11.83],
  ['paper-ink', 'paper', TEXT, 21, 21],
]

/** DOC-54 §3.3: deliberate failures (a disabled control; `lamp` never carries meaning alone on a light surface). */
const ALLOWED_FAILURES = new Set([
  'ink-disabled/surface/light',
  'ink-disabled/surface/dark',
  'lamp/surface/light',
  'lamp/ground/light',
])

const hex = (name: string, theme: Theme) => {
  const token = colors.find((c) => c.name === name)
  if (!token) throw new Error(`No color token ${name}`)
  return token.value[theme]
}

describe('DS-02: contrast of the pairs of DOC-54 §3.2', () => {
  for (const theme of ['light', 'dark'] as const) {
    test.each(pairs)(`%s on %s (${theme})`, (fg, bg, need, ...documented) => {
      const ratio = contrast(hex(fg, theme), hex(bg, theme))
      expect(Math.round(ratio * 100) / 100).toBe(documented[theme === 'light' ? 0 : 1]!)
      if (!ALLOWED_FAILURES.has(`${fg}/${bg}/${theme}`)) expect(ratio).toBeGreaterThanOrEqual(need)
    })
  }

  test('an allowed failure still fails, so the allow-list stays honest', () => {
    for (const entry of ALLOWED_FAILURES) {
      const [fg, bg, theme] = entry.split('/') as [string, string, Theme]
      const need = pairs.find((p) => p[0] === fg && p[1] === bg)![2]
      expect(contrast(hex(fg, theme), hex(bg, theme))).toBeLessThan(need)
    }
  })
})
