import type { TokenStore } from '@rms/client-core'
import { readSafely, type SecureStorage, STORAGE_KEYS } from './storage'

/** The access token in memory and the refresh token in the keychain (DOC-55 §5.1, DR-189). */
export interface MobileTokenStore extends TokenStore {
  saveRefreshCredential(token: string): Promise<void>
  /** The stored refresh token, or `null` when there is none or the keychain failed. */
  refreshCredential(): Promise<string | null>
  /** The local steps of DOC-55 §5.4: the access token, the refresh token, the unit and the device id are gone. */
  clear(): Promise<void>
}

export function createTokenStore(storage: SecureStorage): MobileTokenStore {
  let token: string | null = null
  let expiresAt: number | null = null
  return {
    accessToken: () => token,
    accessExpiresAt: () => expiresAt,
    setAccessToken(next) {
      token = next?.token ?? null
      expiresAt = next?.expiresAt ?? null
    },
    refreshCredential: () => readSafely(storage, STORAGE_KEYS.refresh),
    async saveRefreshCredential(next) {
      // The fetcher awaits this before it replays a waiting call (CL-17). A keychain failure is not fatal for this run: the
      // access token is in memory, and the next cold start finds no usable token and goes to sign-in.
      try {
        await storage.set(STORAGE_KEYS.refresh, next)
      } catch {
        // see above
      }
    },
    async clear() {
      token = null
      expiresAt = null
      for (const key of [STORAGE_KEYS.refresh, STORAGE_KEYS.unit, STORAGE_KEYS.device]) {
        try {
          await storage.remove(key)
        } catch {
          // A key that cannot be deleted is overwritten by the next sign-in.
        }
      }
    },
  }
}
