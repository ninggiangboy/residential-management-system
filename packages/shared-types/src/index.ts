/** Interface languages of the product (DOC-68). */
export const LANGUAGES = ['vi', 'en'] as const
export type Language = (typeof LANGUAGES)[number]
