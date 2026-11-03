import { describe, expect, test } from 'bun:test'
import { INVARIANT_QUERY_TAGS } from './invariant-check'

describe('P2-11: the nineteen ledger invariant queries (DOC-22 §12)', () => {
  test('the tags are Q01…Q19, unique and in order', () => {
    expect(INVARIANT_QUERY_TAGS).toHaveLength(19)
    expect(new Set(INVARIANT_QUERY_TAGS).size).toBe(19)
    expect<readonly string[]>([...INVARIANT_QUERY_TAGS]).toEqual(
      Array.from({ length: 19 }, (_, index) => `Q${String(index + 1).padStart(2, '0')}`),
    )
  })
})
