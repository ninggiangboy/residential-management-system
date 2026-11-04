/** The entry of the web CMS: the same translator over the web catalogs only, so that the other families stay out of its bundle. */
import type { Language } from '@rms/shared-types'
import type { Messages } from './catalog'
import { buildTranslator, type Translator, type TranslatorOptions } from './translator'
import { WEB_VI } from './web-vi'

export type { MessageKey } from './catalog'
export { errorText } from './error-text'
export type { Params, Translator } from './translator'

/** A group of screens whose copy is a chunk of its own, fetched by the routes that need it (DOC-53 §8). */
export type WebFeature = 'finance'

const featureChunks: Record<WebFeature, Record<Language, () => Promise<Partial<Messages>>>> = {
  finance: {
    vi: () => import('./web-finance-vi').then((module) => module.WEB_FINANCE_VI),
    en: () => import('./web-finance-en').then((module) => module.WEB_FINANCE_EN),
  },
}

/**
 * The catalogs in memory. Vietnamese is in the bundle; English is fetched the first time it is asked for, so the first load
 * of `/login` carries one language (DOC-53 §8, DR-308). A feature chunk is merged into the catalog in memory, so a translator
 * built earlier sees its keys.
 */
const loaded: Partial<Record<Language, Partial<Messages>>> = { vi: { ...WEB_VI } }
let english: Promise<void> | undefined
/** The features a route has asked for: a language loaded later gets their copy too. */
const wanted = new Set<WebFeature>()
const featureLoads = new Map<string, Promise<void>>()

function loadBase(lang: Language): Promise<void> {
  if (loaded[lang]) return Promise.resolve()
  english ??= import('./web-en').then(
    (module) => {
      loaded.en = { ...module.WEB_EN }
    },
    (error: unknown) => {
      english = undefined // a later call tries again
      throw error
    },
  )
  return english
}

async function loadFeatureCopy(feature: WebFeature, lang: Language): Promise<void> {
  const key = `${lang}:${feature}`
  let load = featureLoads.get(key)
  if (!load) {
    load = featureChunks[feature][lang]().then(
      (messages) => {
        Object.assign(loaded[lang] ?? {}, messages)
      },
      (error: unknown) => {
        featureLoads.delete(key) // a later call tries again
        throw error
      },
    )
    featureLoads.set(key, load)
  }
  await load
}

/** Resolves once `lang` can be translated, with the copy of every feature asked for; at once when it is all in memory. */
export async function loadWebLanguage(lang: Language): Promise<void> {
  await loadBase(lang)
  await Promise.all([...wanted].map((feature) => loadFeatureCopy(feature, lang)))
}

/**
 * Resolves once the copy of `feature` is in memory for `lang` and for every other language already in memory, so the notice
 * preview, which prints both languages, and a later switch of language find it. A language loaded afterwards fetches it too.
 */
export async function loadWebFeature(feature: WebFeature, lang: Language): Promise<void> {
  wanted.add(feature)
  await loadBase(lang)
  const languages = (Object.keys(loaded) as Language[]).filter((other) => other !== lang)
  await Promise.all([lang, ...languages].map((one) => loadFeatureCopy(feature, one)))
}

/** A translator for `lang`, whose catalog `loadWebLanguage` has loaded. */
export function createTranslator(
  lang: Language,
  options: Omit<TranslatorOptions, 'catalogs'> = {},
): Translator {
  if (!loaded[lang])
    throw new Error(`The ${lang} catalog is not loaded: await loadWebLanguage('${lang}')`)
  return buildTranslator(lang, {
    ...options,
    catalogs: loaded as Readonly<Record<Language, Partial<Messages>>>,
  })
}
