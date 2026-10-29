/** The entry of the web CMS: the same translator over the web catalogs only, so that the other families stay out of its bundle. */
import type { Language } from '@rms/shared-types'
import type { Messages } from './catalog'
import { buildTranslator, type Translator, type TranslatorOptions } from './translator'
import { WEB_VI } from './web-vi'

export type { MessageKey } from './catalog'
export { errorText } from './error-text'
export type { Params, Translator } from './translator'

/**
 * The catalogs in memory. Vietnamese is in the bundle; English is fetched the first time it is asked for, so the first load
 * of `/login` carries one language (DOC-53 §8, DR-308).
 */
const loaded: Partial<Record<Language, Partial<Messages>>> = { vi: WEB_VI }
let english: Promise<void> | undefined

/** Resolves once `lang` can be translated; at once for a language already in memory. */
export function loadWebLanguage(lang: Language): Promise<void> {
  if (loaded[lang]) return Promise.resolve()
  english ??= import('./web-en').then(
    (module) => {
      loaded.en = module.WEB_EN
    },
    (error: unknown) => {
      english = undefined // a later call tries again
      throw error
    },
  )
  return english
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
