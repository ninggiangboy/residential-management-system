/** The secure-store keys of DOC-55 §5.1: letters, digits, `.`, `-` and `_` only. */
export const STORAGE_KEYS = {
  refresh: 'rms.refresh',
  unit: 'rms.unit',
  device: 'rms.device',
  language: 'rms.lang',
  /** The push explanation sheet was shown on this device (DR-199); it stays when the account changes. */
  pushAsked: 'rms.push-asked',
  /** The usage switch (DOC-104 §5.4): on this device, not per account, so another account that signs in inherits it. */
  usageEnabled: 'usage.enabled',
} as const

/**
 * What the token store, the unit store and the language store need from the device keychain. The port keeps them testable on
 * Bun with a fake, and every call is wrapped in `try`/`catch` by its caller: a read failure is "no value" (DOC-55 §5.1).
 */
export interface SecureStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  /** Synchronous reads and writes for the values the first render needs (the language, the unit). */
  getSync(key: string): string | null
  setSync(key: string, value: string): void
}

/** A read that cannot throw: a keychain failure is treated as "no value". */
export async function readSafely(storage: SecureStorage, key: string): Promise<string | null> {
  try {
    return await storage.get(key)
  } catch {
    return null
  }
}

export function readSafelySync(storage: SecureStorage, key: string): string | null {
  try {
    return storage.getSync(key)
  } catch {
    return null
  }
}
