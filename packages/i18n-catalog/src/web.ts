/** The entry of the web CMS: the same translator over `WEB_CATALOGS` only, so that the other families stay out of its bundle. */
import type { Language } from '@rms/shared-types'
import { buildTranslator, type Translator, type TranslatorOptions } from './translator'
import { WEB_CATALOGS } from './web-catalog'

export type { MessageKey } from './catalog'
export { errorText } from './error-text'
export type { Params, Translator } from './translator'

export function createTranslator(
  lang: Language,
  options: Omit<TranslatorOptions, 'catalogs'> = {},
): Translator {
  return buildTranslator(lang, { ...options, catalogs: WEB_CATALOGS })
}
