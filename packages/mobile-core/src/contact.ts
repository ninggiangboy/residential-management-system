import type { Language } from '@rms/shared-types'

export interface BuildingContact {
  name: { vi: string; en: string | null }
  hotline: string | null
  workingHours: { vi: string; en: string | null } | null
  email: string | null
}

/** A `vi`/`en` pair as the language reads it, falling back to Vietnamese when the English text is `null` (DR-71). */
export const localized = (value: { vi: string; en: string | null }, lang: Language): string =>
  (lang === 'en' ? value.en : null) ?? value.vi

export const buildingName = (
  contact: BuildingContact | undefined,
  lang: Language,
): string | null => (contact ? localized(contact.name, lang) : null)

export const hoursOf = (contact: BuildingContact | undefined, lang: Language): string | null =>
  contact?.workingHours ? localized(contact.workingHours, lang) : null

/** `tel:` link of a hotline written for people: spaces removed. */
export const telUrl = (hotline: string): string => `tel:${hotline.replace(/\s+/g, '')}`
