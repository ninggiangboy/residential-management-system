/** Interface languages of the product (DR-71, DOC-68). Vietnamese is the default and the fallback for content. */
export const LANGUAGES = ['vi', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

export const DEFAULT_LANGUAGE: Language = 'vi'

export const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
