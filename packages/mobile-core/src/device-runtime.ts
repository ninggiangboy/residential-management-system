import { getLocales } from 'expo-localization'
import { Platform } from 'react-native'
import { deviceStorage } from './device-storage'
import { bindAppState } from './device-usage'
import { readEnv } from './env'
import { createMobileRuntime } from './runtime'

/** The runtime of an app on a device: the build keys of `app.config.ts`, the keychain and the device language (DOC-55 §3). */
export function createDeviceRuntime(app: 'resident' | 'staff') {
  const env = readEnv()
  const runtime = createMobileRuntime({
    app,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    appVersion: env.appVersion,
    apiBaseUrl: env.apiBaseUrl,
    origin: env.origin,
    storage: deviceStorage,
    deviceLanguageCode: getLocales()[0]?.languageCode ?? null,
  })
  bindAppState(runtime.usage)
  return { runtime, env }
}
