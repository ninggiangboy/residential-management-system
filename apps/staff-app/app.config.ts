import type { ExpoConfig } from 'expo/config'

/**
 * The one place the app's identity, native settings and runtime variables are set (DOC-73 §3). `APP_ENV`, never `NODE_ENV`,
 * decides behavior; nothing here is a secret, because a bundle is public (DOC-41 §15).
 */
const APP_ENV = (process.env.APP_ENV ?? 'local') as
  | 'local'
  | 'development'
  | 'staging'
  | 'production'
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1'
/** Set by `eas init` (Owner's Expo organization, DOC-73 §5.2); absent locally, and then the push token and Observe stay off. */
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID
/** A development client keeps its own identifier so it can live beside the store app on one phone (DOC-73 §2). */
const ID = APP_ENV === 'local' || APP_ENV === 'development' ? 'vn.rms.staff.dev' : 'vn.rms.staff'

const config: ExpoConfig = {
  name: process.env.APP_DISPLAY_NAME ?? 'Residential Staff',
  slug: 'rms-staff',
  scheme: 'rms-staff',
  // Bumped by hand whenever the native side changes (DOC-73 §7); the runtime version follows it. The API refuses an app below MIN_APP_VERSION (1.0.0).
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  platforms: ['ios', 'android'],
  newArchEnabled: true,
  runtimeVersion: { policy: 'appVersion' },
  ...(EAS_PROJECT_ID
    ? {
        updates: {
          url: `https://u.expo.dev/${EAS_PROJECT_ID}`,
          checkAutomatically: 'ON_LOAD' as const,
          fallbackToCacheTimeout: 0,
        },
      }
    : {}),
  ios: {
    bundleIdentifier: ID,
    supportsTablet: false,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: { package: ID },
  // OS permission strings per language (DOC-73 §3.2); not part of the i18n catalog.
  locales: { vi: './locales/vi.json', en: './locales/en.json' },
  plugins: [
    'expo-router',
    'expo-dev-client',
    'expo-secure-store',
    'expo-localization',
    ['expo-notifications', { defaultChannel: 'default' }],
    ['expo-camera', { cameraPermission: false }],
    'expo-font',
  ],
  extra: {
    appEnv: APP_ENV,
    apiBaseUrl: API_BASE_URL,
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
}

export default config
