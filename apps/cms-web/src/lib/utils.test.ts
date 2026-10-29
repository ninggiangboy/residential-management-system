import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cn } from './utils'

describe('cn knows the token utilities (DOC-54 §17.9)', () => {
  test('a later size, radius or shadow replaces an earlier one', () => {
    expect(cn('h-control-md px-3', 'h-auto py-2')).toBe('px-3 h-auto py-2')
    expect(cn('min-h-control-sm', 'min-h-20')).toBe('min-h-20')
    expect(cn('rounded-control', 'rounded-full')).toBe('rounded-full')
    expect(cn('shadow-raised', 'shadow-float')).toBe('shadow-float')
    expect(cn('text-body text-ink', 'text-secondary')).toBe('text-ink text-secondary')
  })

  test('every size, radius and shadow of theme.css is one it merges', () => {
    const theme = readFileSync(
      join(import.meta.dir, '../../../../packages/design-tokens/generated/theme.css'),
      'utf8',
    )
    const names = (pattern: RegExp) => [...theme.matchAll(pattern)].map((m) => m[1]!)
    for (const size of names(/--spacing-([a-z-]+):/g))
      expect([size, cn(`h-control-md`, `h-${size}`)]).toEqual([size, `h-${size}`])
    for (const radius of names(/--radius-([a-z]+):/g))
      expect(cn('rounded-plate', `rounded-${radius}`)).toBe(`rounded-${radius}`)
    for (const shadow of names(/@utility shadow-([a-z]+)/g))
      expect(cn('shadow-raised', `shadow-${shadow}`)).toBe(`shadow-${shadow}`)
  })
})
