import { isLanguage, type Language } from '@rms/shared-types'
import { readSafelySync, type SecureStorage, STORAGE_KEYS } from './storage'

/**
 * Before sign-in: the stored `rms.lang`, else the device language when it is Vietnamese or English, else Vietnamese (DOC-55 §11,
 * UX-12). Signed in, the language is the account's, which `set` receives from `GET /me`.
 */
export function initialLanguage(
  stored: string | null,
  deviceLanguageCode: string | null,
): Language {
  if (isLanguage(stored)) return stored
  const device = deviceLanguageCode?.toLowerCase()
  return isLanguage(device) ? device : 'vi'
}

/** The language as an external store: the fetcher sends `Accept-Language` from `get()`, the screens subscribe. */
export function createLanguageStore(storage: SecureStorage, deviceLanguageCode: string | null) {
  let current = initialLanguage(readSafelySync(storage, STORAGE_KEYS.language), deviceLanguageCode)
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(next: Language, persist = true): void {
      if (next === current) return
      current = next
      if (persist) {
        try {
          storage.setSync(STORAGE_KEYS.language, next)
        } catch {
          // The choice holds for this run.
        }
      }
      for (const listener of listeners) listener()
    },
  }
}

export type LanguageStore = ReturnType<typeof createLanguageStore>
