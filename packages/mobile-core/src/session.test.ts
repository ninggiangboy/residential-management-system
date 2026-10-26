import { describe, expect, test } from 'bun:test'
import type { RefreshResult } from '@rms/client-core'
import { createSessionStore } from './session'
import type { MobileTokenStore } from './token-store'

/** A token store over a plain object, as the keychain would be (CL-17). */
function fakeTokens(
  stored: string | null,
): MobileTokenStore & { saved: string[]; cleared: number } {
  let credential = stored
  let access: { token: string; expiresAt: number } | null = null
  const store = {
    saved: [] as string[],
    cleared: 0,
    accessToken: () => access?.token ?? null,
    accessExpiresAt: () => access?.expiresAt ?? null,
    setAccessToken: (next: { token: string; expiresAt: number } | null) => {
      access = next
    },
    refreshCredential: async () => credential,
    saveRefreshCredential: async (token: string) => {
      credential = token
      store.saved.push(token)
    },
    clear: async () => {
      credential = null
      access = null
      store.cleared++
    },
  }
  return store
}

const harness = (stored: string | null, answers: RefreshResult[]) => {
  const tokens = fakeTokens(stored)
  const calls = { refresh: 0, logout: [] as string[], ended: [] as string[], slept: [] as number[] }
  const session = createSessionStore({
    tokens,
    refresh: async () => {
      calls.refresh++
      return answers[Math.min(calls.refresh, answers.length) - 1] as RefreshResult
    },
    logout: async (token) => {
      calls.logout.push(token)
    },
    onEnded: (reason) => {
      calls.ended.push(reason)
    },
    now: () => 1_000_000,
    sleep: async (ms) => {
      calls.slept.push(ms)
    },
  })
  return { tokens, calls, session }
}

describe('session boot (DOC-55 §5.1, §5.2)', () => {
  test('no stored token is signed out with no reason, and no refresh is made', async () => {
    const { session, calls } = harness(null, [])
    await session.boot()
    expect(session.getState()).toEqual({ status: 'signedOut', reason: null })
    expect(calls.refresh).toBe(0)
  })

  test('CL-17: the rotated refresh token is written, then the access token is live', async () => {
    const { session, tokens } = harness('old', [
      { status: 'ok', accessToken: 'a1', expiresAt: 5, refreshToken: 'new' },
    ])
    await session.boot()
    expect(tokens.saved).toEqual(['new'])
    expect(tokens.accessToken()).toBe('a1')
    expect(session.getState().status).toBe('signedIn')
  })

  test('CL-11: a refused refresh ends the session once, with the reason', async () => {
    const { session, calls, tokens } = harness('old', [{ status: 'denied' }])
    await session.boot()
    expect(session.getState()).toEqual({ status: 'signedOut', reason: 'refresh_failed' })
    expect(calls.ended).toEqual(['refresh_failed'])
    expect(tokens.cleared).toBe(1)
  })

  test('CL-11: no answer three times keeps the token and leaves the state unknown', async () => {
    const { session, calls, tokens } = harness('old', [{ status: 'unknown' }])
    await session.boot()
    expect(calls.refresh).toBe(3)
    expect(calls.slept).toEqual([1000, 3000])
    expect(session.getState().status).toBe('unknown')
    expect(await tokens.refreshCredential()).toBe('old')
    expect(calls.ended).toEqual([])
  })

  test('a refresh that answers on the retry signs in', async () => {
    const { session } = harness('old', [
      { status: 'unknown' },
      { status: 'ok', accessToken: 'a', expiresAt: 9, refreshToken: 'n' },
    ])
    await session.boot()
    expect(session.getState().status).toBe('signedIn')
  })
})

describe('sign-in and sign-out', () => {
  test('a sign-in stores the refresh token and the expiry from expiresIn', async () => {
    const { session, tokens } = harness(null, [])
    await session.signedIn({ accessToken: 'acc', expiresIn: 900, refreshToken: 'ref' })
    expect(tokens.saved).toEqual(['ref'])
    expect(tokens.accessExpiresAt()).toBe(1_000_000 + 900_000)
    expect(session.getState().status).toBe('signedIn')
  })

  test('UIRQ-07: the local steps run when the logout call fails', async () => {
    const tokens = fakeTokens('ref')
    const ended: string[] = []
    const session = createSessionStore({
      tokens,
      refresh: async () => ({ status: 'denied' }),
      logout: async () => {
        throw new Error('offline')
      },
      removeDevice: async () => {
        throw new Error('offline')
      },
      onEnded: (reason) => {
        ended.push(reason)
      },
    })
    await session.signOut()
    expect(session.getState()).toEqual({ status: 'signedOut', reason: 'user' })
    expect(ended).toEqual(['user'])
    expect(await tokens.refreshCredential()).toBeNull()
  })

  test('the logout carries the stored refresh token', async () => {
    const { session, calls } = harness('ref-1', [])
    await session.signOut()
    expect(calls.logout).toEqual(['ref-1'])
  })

  test('subscribers hear every change', async () => {
    const { session } = harness(null, [])
    let heard = 0
    session.subscribe(() => heard++)
    await session.boot()
    expect(heard).toBeGreaterThanOrEqual(2)
  })
})
