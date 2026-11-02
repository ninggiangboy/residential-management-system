import { describe, expect, test } from 'bun:test'
import type { Database } from './database'
import { createGaplessCounter } from './gapless-counter'

/** No database is touched: the schema-name check runs at construction (DOC-14 §11). */
const fake = {} as Database

describe('createGaplessCounter validates the schema name (DOC-14 §11)', () => {
  test('accepts a bare lower-case schema name and returns a counter', () => {
    const counter = createGaplessCounter(fake, 'finance')
    expect(counter.next).toBeFunction()
    expect(() => createGaplessCounter(fake, 'tickets')).not.toThrow()
  })

  test('refuses a name it cannot interpolate as an identifier', () => {
    for (const bad of [
      'public; drop table building',
      'Finance',
      'fin-ance',
      'fin ance',
      'schema.name',
      '1finance',
      '',
    ])
      expect(() => createGaplessCounter(fake, bad)).toThrow(/schema name/)
  })
})
