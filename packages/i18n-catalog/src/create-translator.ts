import { CATALOGS } from './catalog'
import { buildTranslator, type Translator, type TranslatorOptions } from './translator'

/** A translator over the whole catalog: for the API, the mobile apps and tests. The web CMS uses `createTranslator` of `@rms/i18n-catalog/web`. */
export function createTranslator(
  lang: Parameters<typeof buildTranslator>[0],
  options: Omit<TranslatorOptions, 'catalogs'> & Partial<Pick<TranslatorOptions, 'catalogs'>> = {},
): Translator {
  return buildTranslator(lang, { ...options, catalogs: options.catalogs ?? CATALOGS })
}
