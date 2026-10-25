import type { Static, TObject, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { SearchSchemaInput } from '@tanstack/react-router'

/**
 * `validateSearch` of a route (DOC-53 §4 rule 2): each parameter is checked against its TypeBox schema and replaced by its default
 * when it is missing or invalid, so a hand-edited URL never crashes the page. The router parses a top-level `123` into a number; a
 * string parameter takes it back as text.
 */
export function searchParser<T extends TObject>(schema: T, defaults: Partial<Static<T>> = {}) {
  // `SearchSchemaInput` tells the router that a link may leave out what the defaults fill in: the input is partial, the output whole.
  return (raw: Partial<Static<T>> & SearchSchemaInput): Static<T> => {
    const out: Record<string, unknown> = {}
    for (const [key, property] of Object.entries(schema.properties) as [string, TSchema][]) {
      let value: unknown = (raw as Record<string, unknown>)[key]
      if (typeof value === 'number' || typeof value === 'boolean') {
        if (property.type === 'string' || (property.anyOf && Value.Check(property, String(value))))
          value = String(value)
      }
      if (value !== undefined && Value.Check(property, value)) out[key] = value
      else if (key in defaults) out[key] = (defaults as Record<string, unknown>)[key]
    }
    return out as Static<T>
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
