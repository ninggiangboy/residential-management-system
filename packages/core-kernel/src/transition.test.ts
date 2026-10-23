import { describe, expect, test } from 'bun:test'
import { ConflictError } from './errors'
import { decide } from './transition'

describe('decide', () => {
  test('returns the value of the first try that is done', async () => {
    let calls = 0
    const value = await decide(async () => {
      calls++
      return calls < 3 ? { done: false } : { done: true, value: 'ok' }
    })
    expect(value).toBe('ok')
    expect(calls).toBe(3)
  })

  test('gives up with a 409 after the bound', async () => {
    let calls = 0
    const run = decide(async () => {
      calls++
      return { done: false }
    }, 4)
    await expect(run).rejects.toBeInstanceOf(ConflictError)
    expect(calls).toBe(4)
  })
})
