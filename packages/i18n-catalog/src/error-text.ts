import { isMessageKey, type MessageKey } from './catalog'
import type { Translator } from './translator'

/** `error.<code>` with the parameters of `details`, else the server's message (DOC-55 §6, DOC-50 §11). */
export function errorText(
  t: Translator,
  error: { code: string; message: string; details?: unknown; retryAfter?: number },
  extra: Record<string, string | number> = {},
): string {
  const key = `error.${error.code}`
  if (!isMessageKey(key)) return error.message || t('common.error.page.body')
  const params: Record<string, string | number> = { ...extra }
  if (error.code === 'account_locked') {
    const seconds = Number(
      (error.details as { retryAfter?: number } | undefined)?.retryAfter ?? error.retryAfter ?? 0,
    )
    params.minutes = Math.max(1, Math.ceil(seconds / 60))
  }
  if (typeof error.details === 'object' && error.details !== null && !Array.isArray(error.details))
    for (const [name, value] of Object.entries(error.details))
      if ((typeof value === 'string' || typeof value === 'number') && !(name in params))
        params[name] = value
  try {
    return t(key as MessageKey, params)
  } catch {
    return error.message || t('common.error.page.body')
  }
}
