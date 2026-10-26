/** An absolute `http(s)` URL that ends in `/api/v1`; split with a pattern because the URL class of a runtime may be partial. */
const BASE_URL = /^(https?:\/\/[^/?#]+)(?:\/[^?#]*)?\/api\/v1\/?$/

export function validBaseUrl(value: unknown): { apiBaseUrl: string; origin: string } {
  const match = typeof value === 'string' ? BASE_URL.exec(value) : null
  if (!match || typeof value !== 'string')
    throw new Error(
      `API_BASE_URL must be an absolute URL that ends in /api/v1, got "${String(value)}"`,
    )
  return { apiBaseUrl: value.replace(/\/$/, ''), origin: match[1] as string }
}
