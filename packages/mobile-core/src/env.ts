import Constants from 'expo-constants'
import { validBaseUrl } from './base-url'

/**
 * The build keys of DOC-55 §3, read from `app.config.ts` through `extra`: validated at start, so a missing or malformed
 * `API_BASE_URL` stops the app on the first screen and not on the first request. No secret is here (DOC-41 §15).
 */
export function readEnv() {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>
  return {
    ...validBaseUrl(extra.apiBaseUrl),
    /** `local`, `development`, `staging` or `production`; the API decides behavior by its own `APP_ENV`. */
    appEnv: typeof extra.appEnv === 'string' ? extra.appEnv : 'local',
    /** `x.y.z` of `app.config.ts`; sent as `X-App-Version` and compared with the minimum of E-03. */
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
    /** The developer tools (the device check) are hidden in a production build. */
    isProduction: extra.appEnv === 'production',
  } as const
}
