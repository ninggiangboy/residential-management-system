import { createTranslator, isMessageKey, type MessageKey, type Translator } from '@rms/i18n-catalog'
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatPhone,
  type Language,
} from '@rms/shared-types'
import { createContext, type ReactNode, useContext, useMemo, useSyncExternalStore } from 'react'
import { safeStorage } from './utils'

const KEY = 'rms.lang'
const storage = safeStorage()

/** Before sign-in: the stored choice, else the device language when it is Vietnamese or English, else Vietnamese (DOC-55 §11, UX-12). */
function initialLanguage(): Language {
  const stored = storage.get(KEY)
  if (stored === 'vi' || stored === 'en') return stored
  const device = typeof navigator === 'undefined' ? '' : navigator.language.toLowerCase()
  if (device.startsWith('en')) return 'en'
  return 'vi'
}

let current: Language = initialLanguage()
const listeners = new Set<() => void>()

/** Outside React (the fetcher sends `Accept-Language`) the language is read here. */
export const languageStore = {
  get: () => current,
  set(next: Language, persist = true) {
    if (next === current) return
    current = next
    if (persist) storage.set(KEY, next)
    if (typeof document !== 'undefined') document.documentElement.lang = next
    for (const listener of listeners) listener()
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

if (typeof document !== 'undefined') document.documentElement.lang = current

export type T = Translator

interface I18n {
  lang: Language
  t: T
  setLang(lang: Language, persist?: boolean): void
  formatDate(value: string | Date): string
  formatDateTime(value: string | Date): string
  formatPhone(e164: string): string
  formatMoney(amount: number): string
}

const missing = new Set<string>()
const reportMissing = (key: string) => {
  // A key typed as a string at run time: shown as itself, reported once (DOC-55 §11).
  if (missing.has(key)) return
  missing.add(key)
  console.error(`[i18n] missing key ${key}`)
}

const Context = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(languageStore.subscribe, languageStore.get)
  const value = useMemo<I18n>(
    () => ({
      lang,
      t: createTranslator(lang, { onMissing: reportMissing }),
      setLang: languageStore.set,
      formatDate: (v) => formatDate(v, lang),
      formatDateTime: (v) => formatDateTime(v, lang),
      formatPhone,
      formatMoney: (amount) => formatMoney(amount, lang),
    }),
    [lang],
  )
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useI18n(): I18n {
  const value = useContext(Context)
  if (!value) throw new Error('I18nProvider is missing')
  return value
}

export const useT = (): T => useI18n().t

/** `error.<code>` with the parameters of `details`, else the server's message (DOC-55 §6, DOC-50 §11). */
export function errorText(
  t: T,
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
