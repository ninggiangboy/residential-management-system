import { describe, expect, test } from 'bun:test'
import { retryableSqlState, withSerializationRetry } from './serialization-retry'

/** A driver error as drizzle wraps it: the SQLSTATE is on `cause` (DOC-12 §8.1 item 4). */
const pgError = (code: string) => Object.assign(new Error('query failed'), { cause: { code } })

const noSleep = { sleep: async () => {}, random: () => 0 }

describe('withSerializationRetry (DOC-12 §8.1 item 4, FR-08.8)', () => {
  test('IN-34 a forced 40001 on the first attempt is retried and the second attempt answers', async () => {
    let calls = 0
    const out = await withSerializationRetry(async () => {
      calls += 1
      if (calls === 1) throw pgError('40001')
      return 'posted'
    }, noSleep)
    expect(out).toBe('posted')
    expect(calls).toBe(2)
  })

  test('IN-34 40P01 three times then success: four attempts, the fourth answers', async () => {
    const retried: Array<[string, number]> = []
    let calls = 0
    const out = await withSerializationRetry(
      async () => {
        calls += 1
        if (calls <= 3) throw pgError('40P01')
        return calls
      },
      { ...noSleep, onRetry: (sqlstate, attempt) => retried.push([sqlstate, attempt]) },
    )
    expect(out).toBe(4)
    expect(retried).toEqual([
      ['40P01', 1],
      ['40P01', 2],
      ['40P01', 3],
    ])
  })

  test('IN-34 four failures: the fourth throws (the webhook answers 503)', async () => {
    let calls = 0
    const run = withSerializationRetry(async () => {
      calls += 1
      throw pgError('40P01')
    }, noSleep)
    await expect(run).rejects.toThrow('query failed')
    expect(calls).toBe(4)
  })

  test('another error is never retried', async () => {
    let calls = 0
    const run = withSerializationRetry(async () => {
      calls += 1
      throw pgError('23505')
    }, noSleep)
    await expect(run).rejects.toThrow()
    expect(calls).toBe(1)
  })

  test('the jitter is 20 to 60 ms', async () => {
    const waits: number[] = []
    for (const random of [0, 0.999]) {
      let calls = 0
      await withSerializationRetry(
        async () => {
          calls += 1
          if (calls === 1) throw pgError('40001')
        },
        { sleep: async (ms) => void waits.push(ms), random: () => random },
      )
    }
    expect(waits).toEqual([20, 60])
  })

  test('the SQLSTATE is found on the error, on cause, or not at all', () => {
    expect(retryableSqlState(Object.assign(new Error(), { code: '40001' }))).toBe('40001')
    expect(retryableSqlState(pgError('40P01'))).toBe('40P01')
    expect(retryableSqlState(pgError('55P03'))).toBeNull()
    expect(retryableSqlState('not an error')).toBeNull()
  })
})
