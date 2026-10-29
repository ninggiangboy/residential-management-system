import hien from '../tokens.json' with { type: 'json' }
import density from '../web.json' with { type: 'json' }

/**
 * `tokens.json` (Hiên v1, copied unchanged from the design canvas) read into plain lists, aliases resolved, plus
 * `web.json`, the web density (DOC-54 §5.5, DR-307). The generator (`bun run tokens:build`) and the DS- tests read the
 * tokens only through this file.
 */
export type Theme = 'light' | 'dark'

export interface Themed {
  readonly name: string
  readonly value: Readonly<Record<Theme, string>>
}
export interface Scale {
  readonly name: string
  readonly px: number
}
export interface TextStyle {
  readonly name: string
  readonly family: 'sans' | 'plate'
  readonly fontSize: number
  readonly lineHeight: number
  readonly fontWeight: number
  /** In em, as the canvas writes it; native converts it to dp. */
  readonly letterSpacing: number
}
export interface FontFace {
  readonly family: 'sans' | 'plate'
  readonly cssFamily: string
  readonly weight: number
  /** File name without extension: also the PostScript name of the static `ttf` instance (DOC-54 §4.1). */
  readonly file: string
}

/** Surfaces that stay light in both themes: the resident QR, the VietQR image and receipts (DOC-54 §11, DR-182). */
const FIXED_COLORS: readonly Themed[] = [
  { name: 'paper', value: { light: '#FFFFFF', dark: '#FFFFFF' } },
  { name: 'paper-ink', value: { light: '#000000', dark: '#000000' } },
]

const px = (value: string) => {
  if (!/^-?\d+(\.\d+)?px$/.test(value)) throw new Error(`Expected a px value, got ${value}`)
  return Number.parseFloat(value)
}

function resolveAliases(tokens: readonly Themed[]): Themed[] {
  const byName = new Map(tokens.map((t) => [t.name, t]))
  const resolve = (value: string, theme: Theme, seen: string[] = []): string => {
    const alias = /^\{([a-z-]+)\}$/.exec(value)?.[1]
    if (!alias) return value
    const target = byName.get(alias)
    if (!target || seen.includes(alias)) throw new Error(`Bad alias {${alias}}`)
    return resolve(target.value[theme], theme, [...seen, alias])
  }
  return tokens.map((t) => ({
    name: t.name,
    value: { light: resolve(t.value.light, 'light'), dark: resolve(t.value.dark, 'dark') },
  }))
}

/** The 43 colors of the canvas, the web additions, then the fixed ones; `success*` resolved to the `teal*` values they alias. */
export const colors: readonly Themed[] = [
  ...resolveAliases(hien.color.tokens),
  ...density.color,
  ...FIXED_COLORS,
]

export const shadows: readonly Themed[] = [...hien.shadow.tokens, ...density.shadow]

export const spacing: readonly Scale[] = hien.spacing.tokens.map((t) => ({
  name: t.name,
  px: px(t.value),
}))
export const radius: readonly Scale[] = hien.radius.tokens.map((t) => ({
  name: t.name,
  px: px(t.value),
}))
export const sizes: readonly Scale[] = hien.size.tokens.map((t) => ({
  name: t.name,
  px: px(t.value),
}))

export const textStyles: readonly TextStyle[] = hien.type.groups.flatMap((group) =>
  group.styles.map((s) => ({
    name: s.name,
    family: group.family as 'sans' | 'plate',
    fontSize: px(s.fontSize),
    lineHeight: px(s.lineHeight),
    fontWeight: s.fontWeight,
    letterSpacing: 'letterSpacing' in s && s.letterSpacing ? Number.parseFloat(s.letterSpacing) : 0,
  })),
)

/**
 * The scales of the web outputs (`tokens.css`, `theme.css`): the canvas values with `web.json` written over them, by name.
 * The apps keep the canvas values (DR-307).
 */
const overScale = (scale: readonly Scale[], over: Readonly<Record<string, string>>): Scale[] =>
  scale.map((s) => {
    const value = over[s.name]
    return value ? { name: s.name, px: px(value) } : s
  })
const typeOver: Readonly<Record<string, (typeof density.type)[keyof typeof density.type]>> =
  density.type

export const web = {
  radius: overScale(radius, density.radius),
  sizes: overScale(sizes, density.size),
  textStyles: textStyles.map((s): TextStyle => {
    const over = typeOver[s.name]
    if (!over) return s
    return {
      ...s,
      fontSize: px(over.fontSize),
      lineHeight: px(over.lineHeight),
      fontWeight: over.fontWeight,
      letterSpacing: 'letterSpacing' in over ? Number.parseFloat(over.letterSpacing) : 0,
    }
  }),
} as const

export const families: Readonly<Record<'sans' | 'plate', string>> = hien.type.families

export const fonts: readonly FontFace[] = hien.type.fonts.map((f) => ({
  family: f.family === 'Geologica' ? 'sans' : 'plate',
  cssFamily: f.family,
  weight: Number(f.weight),
  file: f.file.replace(/^fonts\//, '').replace(/\.woff2$/, ''),
}))

/** The static font a native text style uses: React Native picks a file by family name, not by weight. */
export function nativeFont(family: 'sans' | 'plate', weight: number): string {
  const face = fonts.find((f) => f.family === family && f.weight === weight)
  if (!face) throw new Error(`No ${family} font of weight ${weight}`)
  return face.file
}
