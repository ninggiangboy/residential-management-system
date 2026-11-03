import { describe, expect, test } from 'bun:test'
import { monthOf, unitChunks } from './fan-out'

describe('the fan-out chunk (DOC-09 §3.4, DOC-21 §2.2)', () => {
  test('MC-06 1,201 units are three parts of 500, 500 and 201', () => {
    const ids = Array.from({ length: 1_201 }, (_, i) => `u${i}`)
    const chunks = unitChunks(ids)
    expect(chunks.map((c) => [c.part, c.parts, c.unitIds.length])).toEqual([
      [1, 3, 500],
      [2, 3, 500],
      [3, 3, 201],
    ])
    expect(chunks.flatMap((c) => c.unitIds)).toEqual(ids)
  })

  test('500 units are one part; no unit is no part', () => {
    expect(unitChunks(Array.from({ length: 500 }, (_, i) => `u${i}`))).toHaveLength(1)
    expect(unitChunks([])).toEqual([])
  })

  test('the fee month of an event is YYYY-MM', () => {
    expect(monthOf('2026-10-01')).toBe('2026-10')
  })
})
