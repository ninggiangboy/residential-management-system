import { createTranslator, errorText, type MessageKey, type Translator } from '@rms/i18n-catalog'
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatPhone,
  type Language,
} from '@rms/shared-types'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createContext, type ReactNode, useContext, useMemo, useSyncExternalStore } from 'react'
import { Platform } from 'react-native'
import { PERSIST_MAX_AGE_MS, persister, shouldPersistQuery } from './query'
import type { MobileRuntime } from './runtime'
import type { SessionState } from './session'
import { isBelowMinimum } from './version'

const RuntimeContext = createContext<MobileRuntime | null>(null)

export function useRuntime(): MobileRuntime {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('MobileProvider is missing')
  return runtime
}

const missing = new Set<string>()
const reportMissing = (key: string) => {
  // A key typed as a string at run time is shown as itself and reported once (DOC-55 §11).
  if (missing.has(key)) return
  missing.add(key)
  console.error(`[i18n] missing key ${key}`)
}

/**
 * The providers every app root needs, in order: the runtime, the query client with the persisted cache (a `buster` of the app
 * version drops it on an update, DOC-55 §9.2) and nothing else. Screens read the rest through the hooks below.
 */
export function MobileProvider({
  runtime,
  children,
}: {
  runtime: MobileRuntime
  children: ReactNode
}) {
  return (
    <RuntimeContext.Provider value={runtime}>
      <PersistQueryClientProvider
        client={runtime.queryClient}
        persistOptions={{
          persister,
          maxAge: PERSIST_MAX_AGE_MS,
          buster: runtime.appVersion,
          dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
        }}
      >
        {children}
      </PersistQueryClientProvider>
    </RuntimeContext.Provider>
  )
}

export function useSession(): SessionState {
  const { session } = useRuntime()
  return useSyncExternalStore(session.subscribe, session.getState, session.getState)
}

export function useSelectedUnitId(): string | null {
  const { unit } = useRuntime()
  return useSyncExternalStore(unit.subscribe, unit.get, unit.get)
}

export function useUnitLost(): boolean {
  const { unit } = useRuntime()
  return useSyncExternalStore(unit.subscribe, unit.wasLost, unit.wasLost)
}

export interface AppRelease {
  minVersion: string
  storeUrl: { ios: string | null; android: string | null }
}

/**
 * The blocking update screen of DOC-55 §16: the installed version is below `apps.<app>.minVersion` of E-03 (the early check,
 * UIRA-07), or a call was answered 426 `upgrade_required` (the late check). The store link is the one of the platform.
 */
export function useUpgradeRequired(
  release: AppRelease | undefined,
): { storeUrl: string | null } | null {
  const { upgradeGate, appVersion } = useRuntime()
  const late = useSyncExternalStore(upgradeGate.subscribe, upgradeGate.get, upgradeGate.get)
  const store = (
    urls: AppRelease['storeUrl'] | { ios?: string | null; android?: string | null } | undefined,
  ) => (Platform.OS === 'ios' ? urls?.ios : urls?.android) ?? null
  if (late) return { storeUrl: late.storeUrl ?? store(release?.storeUrl) }
  if (release && isBelowMinimum(appVersion, release.minVersion))
    return { storeUrl: store(release.storeUrl) }
  return null
}

export interface I18n {
  lang: Language
  t: Translator
  setLang(lang: Language, persist?: boolean): void
  formatDate(value: string | Date): string
  formatDateTime(value: string | Date): string
  formatPhone(e164: string): string
  formatMoney(amount: number): string
  /** `error.<code>` with the parameters of `details`, else the server's message. */
  errorText(error: Parameters<typeof errorText>[1], extra?: Record<string, string | number>): string
}

export function useI18n(): I18n {
  const { language } = useRuntime()
  const lang = useSyncExternalStore(language.subscribe, language.get, language.get)
  return useMemo<I18n>(() => {
    const t = createTranslator(lang, { onMissing: reportMissing })
    return {
      lang,
      t,
      setLang: language.set,
      formatDate: (v) => formatDate(v, lang),
      formatDateTime: (v) => formatDateTime(v, lang),
      formatPhone,
      formatMoney: (amount) => formatMoney(amount, lang),
      errorText: (error, extra) => errorText(t, error, extra),
    }
  }, [lang, language.set])
}

export const useT = (): Translator => useI18n().t

export type { MessageKey }
