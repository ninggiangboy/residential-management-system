import * as SecureStore from 'expo-secure-store'
import type { SecureStorage } from './storage'

/**
 * `expo-secure-store` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` on iOS, so a backup does not carry the refresh token to another
 * device (DOC-55 §5.1, DR-189). iOS Keychain data may survive an uninstall; the app relies on neither outcome.
 */
export const deviceStorage: SecureStorage = {
  get: (key) =>
    SecureStore.getItemAsync(key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  set: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  remove: (key) => SecureStore.deleteItemAsync(key),
  getSync: (key) => SecureStore.getItem(key),
  setSync: (key, value) => SecureStore.setItem(key, value),
}
