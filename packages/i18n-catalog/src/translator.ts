import type { Language, Phrase } from '@rms/shared-types'
import { IntlMessageFormat } from 'intl-messageformat'
import { CATALOGS, type MessageKey, type Messages } from './catalog'

export type Params = Readonly<Record<string, string | number>>

export interface Translator {
  readonly lang: Language
  /** The message of `key` with its ICU arguments; amounts and dates arrive already formatted (DOC-68 §1). */
  (key: MessageKey, params?: Params): string
  /** A phrase of `@rms/shared-types` (`relativeTime`, `daysLeft`) as text. */
  phrase(phrase: Phrase): string
}

export interface TranslatorOptions {
  readonly catalogs?: Readonly<Record<Language, Messages>>
  /** Called when a key has no message (possible only for a key typed as a string at run time); the key is shown. */
  readonly onMissing?: (key: string, lang: Language) => void
}

/** One translator per language; messages are parsed once and cached. */
export function createTranslator(lang: Language, options: TranslatorOptions = {}): Translator {
  const messages = (options.catalogs ?? CATALOGS)[lang]
  const compiled = new Map<string, IntlMessageFormat>()

  const t = (key: MessageKey, params?: Params): string => {
    const message = messages[key] as string | undefined
    if (message === undefined) {
      options.onMissing?.(key, lang)
      return key
    }
    let format = compiled.get(key)
    if (!format) {
      format = new IntlMessageFormat(message, lang)
      compiled.set(key, format)
    }
    return String(format.format(params))
  }

  return Object.assign(t, {
    lang,
    phrase: (p: Phrase) => ('text' in p ? p.text : t(p.key, p.params)),
  })
}
