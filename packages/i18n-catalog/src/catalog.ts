import type { Language } from '@rms/shared-types'
import { mailEn } from './mail/en'
import { mailVi } from './mail/vi'
import { en as sharedEn } from './shared/en'
import { vi as sharedVi } from './shared/vi'

const en = { ...sharedEn, ...mailEn } as const
const vi: Record<keyof typeof en, string> = { ...sharedVi, ...mailVi }

/**
 * The message catalog of the whole product (DR-71, DOC-68): one flat map of ICU messages per language, keyed by the
 * dotted key of DOC-68 §1. The shared families live in `shared/`; the staff mails of `identity` (`mail.*`, DOC-26 §5.4) are
 * in `mail/`; screen keys (`res.*`, `staff.*`, `web.*`) are added by the screen tasks in their own files and spread in here.
 */
export type MessageKey = keyof typeof en
export type Messages = Readonly<Record<MessageKey, string>>

export const CATALOGS: Readonly<Record<Language, Messages>> = { vi, en }

/** The first segments a key of the shared catalog may have; any other first segment belongs to a screen document (DOC-68 §1). */
export const SHARED_FAMILIES = [
  'error',
  'status',
  'common',
  'auth',
  'offline',
  'upgrade',
  'mail',
] as const

export const isMessageKey = (key: string): key is MessageKey => Object.hasOwn(en, key)
