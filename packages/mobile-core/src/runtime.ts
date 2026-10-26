import { ApiException, createAuthenticatedFetch, type Gates } from '@rms/client-core'
import { createTermsGate, createUpgradeGate } from './gates'
import { createLanguageStore } from './language'
import { clearPersistedCache, createAppQueryClient } from './query'
import { randomId } from './random-id'
import { createRefreshTransport } from './refresh'
import { createSessionStore } from './session'
import type { SecureStorage } from './storage'
import { createTokenStore } from './token-store'
import { createUnitStore } from './unit'

export interface MobileRuntimeOptions {
  app: 'resident' | 'staff'
  /** `x.y.z` of `app.config.ts`; sent as `X-App-Version` (DOC-55 §4.2). */
  appVersion: string
  /** Ends in `/api/v1` (DOC-41 §15). */
  apiBaseUrl: string
  /** The scheme and host of `apiBaseUrl`: the Eden tree is created on it and mounts `.api.v1` (DOC-55 §4.1). */
  origin: string
  storage: SecureStorage
  /** `expo-localization`'s first locale language code, or `null`. */
  deviceLanguageCode: string | null
}

/**
 * Everything one app needs, built once at start and wired together (DOC-55 §2.2, §4, §5): the query client, the token store, the
 * session, the unit and language stores, the two gates and the one authenticated fetcher. The app passes `authenticatedFetch` to
 * Eden Treaty with its own `App` type; this package never imports the API (DOC-12 §6.3).
 */
export function createMobileRuntime(options: MobileRuntimeOptions) {
  const { app, appVersion, apiBaseUrl, storage } = options
  // A 403 `membership_inactive` (a lock or a removal) removes that unit's queries, refetches `['me']` and sends the resident to
  // `Unit-Pick` (DOC-55 §6, §7.3 rule 3). The other units still work.
  const queryClient = createAppQueryClient((error) => {
    if (error instanceof ApiException && error.error.code === 'membership_inactive') {
      unit.drop({ lost: true })
      void queryClient.invalidateQueries({ queryKey: ['me'] })
    }
  })
  const tokens = createTokenStore(storage)
  const language = createLanguageStore(storage, options.deviceLanguageCode)
  const unit = createUnitStore(storage, queryClient)
  const termsGate = createTermsGate()
  const upgradeGate = createUpgradeGate()
  const refresh = createRefreshTransport({ baseUrl: apiBaseUrl, tokens, app, appVersion })

  const session = createSessionStore({
    tokens,
    refresh,
    logout: async (refreshToken) => {
      await fetch(`${apiBaseUrl}/auth/logout`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-app-id': app,
          'x-app-version': appVersion,
        },
        body: JSON.stringify({ refreshToken }),
      })
    },
    // The local steps that are not the tokens (DOC-55 §5.4): the caches of this account go, the language stays.
    onEnded: async () => {
      unit.drop()
      queryClient.clear()
      await clearPersistedCache()
      termsGate.resolve()
    },
  })

  const gates: Gates = {
    termsRequired: () => termsGate.request(),
    upgradeRequired: (details) => upgradeGate.require(details),
    signedOut: (reason) => {
      void (reason === 'user' ? session.signOut() : session.endLocally(reason))
    },
    language: () => language.get(),
    unitId: () => unit.get(),
  }

  const authenticatedFetch = createAuthenticatedFetch({
    env: { app, appVersion, baseUrl: apiBaseUrl },
    tokens,
    gates,
    refresh,
    randomId,
  })

  return {
    app,
    appVersion,
    apiBaseUrl,
    origin: options.origin,
    queryClient,
    tokens,
    session,
    language,
    unit,
    termsGate,
    upgradeGate,
    authenticatedFetch,
  }
}

export type MobileRuntime = ReturnType<typeof createMobileRuntime>
