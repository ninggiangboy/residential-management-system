const UNKNOWN = 'Unknown device'

/** `rms-resident/1.0.0 (iOS 19.1; iPhone17,1)` → `iPhone17,1, iOS 19.1` (DOC-26 §3.7). */
const APP_AGENT = /^rms-(?:resident|staff)\/\S+ \(([^;]+);\s*([^)]+)\)/

const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg(?:e|A|iOS)?\//, 'Edge'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

// Android and iOS before macOS and Linux: their agents also say "Linux" and "like Mac OS X".
const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Windows/, 'Windows'],
  [/Macintosh|Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
]

/**
 * The label a session list shows, computed on read from the raw `user_agent` (stored at most 300 characters). An app sends
 * `rms-<app>/<version> (<os>; <model>)`; a browser becomes `"<browser> on <os>"` by five patterns; anything else is
 * `"Unknown device"`. No library is used (DOC-26 §3.7).
 */
export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return UNKNOWN
  const app = APP_AGENT.exec(userAgent)
  if (app) return `${app[2]?.trim()}, ${app[1]?.trim()}`
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1]
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1]
  return browser && system ? `${browser} on ${system}` : UNKNOWN
}
