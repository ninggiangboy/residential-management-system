/** The build keys of the web CMS (DOC-55 §3, DOC-41 §15): read at build time, baked into the bundle, no secret. */
const raw = import.meta.env as Record<string, string | undefined>

function validBaseUrl(value: string): string {
  try {
    const url = new URL(value)
    if (!url.pathname.replace(/\/$/, '').endsWith('/api/v1')) throw new Error('path')
    return value.replace(/\/$/, '')
  } catch {
    throw new Error(
      `VITE_API_BASE_URL must be an absolute URL that ends in /api/v1, got "${value}"`,
    )
  }
}

export const env = {
  /** Ends in `/api/v1`. */
  apiBaseUrl: validBaseUrl(raw.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1'),
  /** Shown as a badge on a build that is not production; behavior never reads it (the API decides by `APP_ENV`). */
  appEnv: raw.VITE_APP_ENV ?? 'local',
} as const
