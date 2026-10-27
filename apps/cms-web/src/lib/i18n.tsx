import { createTranslator, type Translator } from '@rms/i18n-catalog/web'
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

export { errorText } from '@rms/i18n-catalog/web'
