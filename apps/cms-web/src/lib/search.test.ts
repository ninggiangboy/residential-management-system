import { describe, expect, test } from 'bun:test'
import { f, safeRedirect, searchParser } from './search'

describe('UIWO-04: a redirect is an app path or nothing', () => {
  test.each([
    ['/units', '/units'],
    ['/units?q=an', '/units?q=an'],
    [
      '/units/0192f3c4-5a1e-7000-8000-000000000051?tab=history',
      '/units/0192f3c4-5a1e-7000-8000-000000000051?tab=history',
    ],
    ['/staff/new', '/staff/new'],
    ['https://evil.example', undefined],
    ['//evil.example', undefined],
    ['/\\evil.example', undefined],
    ['/unknown', undefined],
    ['/unitsx', undefined],
    ['units', undefined],
    ['', undefined],
    [undefined, undefined],
  ])('%s', (input, expected) => {
    expect(safeRedirect(input)).toBe(expected)
  })
})

describe('a search validator replaces what is missing or invalid by the default (DOC-53 §4 rule 2)', () => {
  const parser = searchParser(
    {
      q: f.string(10),
      status: f.oneOf('active', 'locked'),
      page: f.int(1, 100),
      flag: f.bool(),
      id: f.pattern(/^[0-9a-f-]{36}$/, 36),
    },
    { page: 1 },
  )
  // The router adds its marker type to the input; a test passes plain objects.
  const parse = (raw: Record<string, unknown>) => parser(raw as never)

  test('a valid input is kept', () => {
    expect(parse({ q: 'an', status: 'active', page: 3, flag: true })).toEqual({
      q: 'an',
      status: 'active',
      page: 3,
      flag: true,
    })
  })
  test('an invalid value is dropped and a missing page is 1', () => {
    expect(parse({ status: 'boss', page: 0 })).toEqual({ page: 1 })
    expect(parse({ page: 1.5, flag: 'yes', q: 'x'.repeat(11) })).toEqual({ page: 1 })
    expect(parse({})).toEqual({ page: 1 })
  })
  test('a number or a boolean the router parsed out of a string parameter becomes the string again', () => {
    expect(parse({ q: 123 as never, page: 2 })).toEqual({ q: '123', page: 2 })
    expect(parse({ q: true as never })).toEqual({ q: 'true', page: 1 })
  })
  test('an id must match its pattern', () => {
    expect(parse({ id: '0192f3c4-5a1e-7000-8000-000000000051' }).id).toBe(
      '0192f3c4-5a1e-7000-8000-000000000051',
    )
    expect(parse({ id: 'nope' }).id).toBeUndefined()
  })
})
