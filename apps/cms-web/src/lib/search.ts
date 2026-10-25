import type { SearchSchemaInput } from '@tanstack/react-router'

/**
 * `validateSearch` of a route (DOC-53 §4 rule 2): each parameter is checked against a small parser and replaced by its default when
 * it is missing or invalid, so a hand-edited URL never crashes the page. The parsers are written here and not with TypeBox: the
 * router runs them in the entry chunk of every page, and TypeBox's builders and checker would weigh as much as the sign-in page
 * (DR-264). TypeBox stays in the forms, which load with their screens.
 */
export interface Field<T> {
  parse(value: unknown): T | undefined
}

const field = <T>(parse: (value: unknown) => T | undefined): Field<T> => ({ parse })

/** A number or a boolean the router parsed out of text comes back as text for a string parameter (`?q=123`). */
const textOf = (value: unknown): string | undefined =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : undefined

export const f = {
  string: (max = 300) =>
    field<string>((value) => {
      const text = textOf(value)
      return text !== undefined && text.length <= max ? text : undefined
    }),
  pattern: (pattern: RegExp, max = 300) =>
    field<string>((value) => {
      const text = textOf(value)
      return text !== undefined && text.length <= max && pattern.test(text) ? text : undefined
    }),
  int: (min: number, max: number) =>
    field<number>((value) =>
      typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
        ? value
        : undefined,
    ),
  bool: () => field<boolean>((value) => (typeof value === 'boolean' ? value : undefined)),
  oneOf: <const V extends string>(...values: V[]) =>
    field<V>((value) =>
      typeof value === 'string' && (values as string[]).includes(value) ? (value as V) : undefined,
    ),
}

type Shape = Record<string, Field<unknown>>
type Parsed<S extends Shape> = { [K in keyof S]?: NonNullable<ReturnType<S[K]['parse']>> }

/**
 * The validator of a route: the input is whatever the URL holds (every parameter optional, so a link may omit what a default
 * fills in), the output has the defaults. `SearchSchemaInput` tells the router so.
 */
export function searchParser<S extends Shape, D extends Parsed<S> = Record<never, never>>(
  shape: S,
  defaults?: D,
) {
  return (
    raw: Parsed<S> & SearchSchemaInput,
  ): Parsed<S> & Required<Pick<Parsed<S>, keyof D & keyof S>> => {
    const out: Record<string, unknown> = {}
    for (const [key, parser] of Object.entries(shape)) {
      const parsed = parser.parse((raw as Record<string, unknown>)[key])
      if (parsed !== undefined) out[key] = parsed
      else if (defaults && key in defaults) out[key] = (defaults as Record<string, unknown>)[key]
    }
    return out as Parsed<S> & Required<Pick<Parsed<S>, keyof D & keyof S>>
  }
}

/** The routes a `redirect` may name (DOC-53 §4 rule 5): an app path of the URL map, never another origin. */
const KNOWN_PREFIXES = [
  '/units',
  '/residents',
  '/import',
  '/staff',
  '/building',
  '/profile',
] as const

/** `redirect` is accepted only if it starts with a single `/` and is a route of the URL map; anything else is dropped (UIWO-04). */
export function safeRedirect(value: string | undefined): string | undefined {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return undefined
  const path = value.split(/[?#]/)[0] ?? ''
  const known = KNOWN_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  return known ? value : undefined
}
