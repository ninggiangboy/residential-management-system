import { describe, expect, test } from 'bun:test'
import { DatabaseUnreachableError, waitForDatabase } from './boot'

/** A clock the test moves by hand: `sleep` advances it, so a 30 s wait takes no time. */
function fakeTime() {
  let now = 0
  const sleep = async (ms: number) => {
    now += ms
  }
  return { now: () => now, sleep, elapsed: () => now }
}

describe('waitForDatabase (DR-161: retry the first connection for 30 s, then give up)', () => {
  test('returns at once when the database answers', async () => {
    const time = fakeTime()
    await waitForDatabase({ ping: async () => {} }, { ...time })
    expect(time.elapsed()).toBe(0)
  })

  test('retries every second and succeeds when the database comes up after a reboot', async () => {
    const time = fakeTime()
    let attempts = 0
    await waitForDatabase(
      {
        ping: async () => {
          if (++attempts < 6) throw new Error('ECONNREFUSED')
        },
      },
      { ...time },
    )
    expect(attempts).toBe(6)
    expect(time.elapsed()).toBe(5_000)
  })

  test('gives up after 30 s with the last failure as the cause', async () => {
    const time = fakeTime()
    const cause = new Error('ECONNREFUSED')
    const error = await waitForDatabase(
      { ping: async () => Promise.reject(cause) },
      { ...time },
    ).catch((e) => e)
    expect(error).toBeInstanceOf(DatabaseUnreachableError)
    expect((error as Error).cause).toBe(cause)
    expect(time.elapsed()).toBeGreaterThanOrEqual(29_000)
    expect(time.elapsed()).toBeLessThanOrEqual(30_000)
  })
})
