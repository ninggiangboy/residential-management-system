import { describe, expect, test } from 'bun:test'
import { Type } from '@sinclair/typebox'
import { safeRedirect, searchParser } from './search'

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

describe('a search validator replaces what is missing or invalid by the default', () => {
  const schema = Type.Object({
    q: Type.Optional(Type.String()),
    status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('locked')])),
    page: Type.Integer({ minimum: 1 }),
    flag: Type.Optional(Type.Boolean()),
  })
  const parser = searchParser(schema, { page: 1 })
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
    expect(parse({})).toEqual({ page: 1 })
  })
  test('a number the router parsed out of a string parameter becomes the string again', () => {
    expect(parse({ q: 123 as unknown as string, page: 2 })).toEqual({ q: '123', page: 2 })
  })
})
