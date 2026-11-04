import {
  createTranslator,
  loadWebFeature,
  loadWebLanguage,
  type Translator,
} from '@rms/i18n-catalog/web'
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

/** The language shown; it changes only once its catalog is in memory, so no page draws keys or the other language. */
let current: Language = initialLanguage()
/** The language last asked for: when two switches cross, the later one wins. */
let wanted: Language = current
const listeners = new Set<() => void>()

const show = (next: Language) => {
  current = next
  if (typeof document !== 'undefined') document.documentElement.lang = next
  for (const listener of listeners) listener()
}

/**
 * The catalog of the starting language (Vietnamese is in the bundle, English is a chunk, DR-308): `main.tsx` draws the first
 * page once it is in, behind the frame of `index.html`. A chunk that cannot be fetched falls back to Vietnamese.
 */
export const i18nReady: Promise<void> = loadWebLanguage(current).catch(() => {
  wanted = 'vi'
  show('vi')
})

/** Outside React (the fetcher sends `Accept-Language`) the language is read here. */
export const languageStore = {
  get: () => current,
  set(next: Language, persist = true) {
    if (next === wanted) return
    wanted = next
    if (persist) storage.set(KEY, next)
    loadWebLanguage(next).then(
      () => {
        if (wanted === next && current !== next) show(next)
      },
      () => {
        // The chunk could not be fetched (offline, a deploy in between): the page stays in the language it shows.
        if (wanted === next) wanted = current
      },
    )
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

if (typeof document !== 'undefined') document.documentElement.lang = current

/**
 * The loader of a finance route: the copy of the finance screens is a chunk of its own, kept out of the first load of `/login`
 * (DOC-53 §8, DR-308), so the route waits for it before its page draws. A chunk that cannot be fetched fails the route, whose
 * error screen offers a retry.
 */
export const loadFinanceText = (): Promise<void> => loadWebFeature('finance', current)

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
