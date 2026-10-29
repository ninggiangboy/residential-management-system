import type { Messages } from './catalog'
import { en as sharedEn } from './shared/en'
import { webEn } from './web/en'

/** The web CMS in English: a chunk of its own, loaded only by a person who reads English (`loadWebLanguage`, DR-308). */
export const WEB_EN: Partial<Messages> = { ...sharedEn, ...webEn }
