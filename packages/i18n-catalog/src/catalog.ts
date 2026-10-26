import type { Language } from '@rms/shared-types'
import { importEn } from './import/en'
import { importVi } from './import/vi'
import { mailEn } from './mail/en'
import { mailVi } from './mail/vi'
import { resEn } from './res/en'
import { resVi } from './res/vi'
import { en as sharedEn } from './shared/en'
import { vi as sharedVi } from './shared/vi'
import { smsEn } from './sms/en'
import { smsVi } from './sms/vi'
import { staffEn } from './staff/en'
import { staffVi } from './staff/vi'
import { webEn } from './web/en'
import { webVi } from './web/vi'

const en = {
  ...sharedEn,
  ...mailEn,
  ...smsEn,
  ...importEn,
  ...webEn,
  ...resEn,
  ...staffEn,
} as const
const vi: Record<keyof typeof en, string> = {
  ...sharedVi,
  ...mailVi,
  ...smsVi,
  ...importVi,
  ...webVi,
  ...resVi,
  ...staffVi,
}

/**
 * The message catalog of the whole product (DR-71, DOC-68): one flat map of ICU messages per language, keyed by the
 * dotted key of DOC-68 §1. The shared families live in `shared/`; the staff mails (`mail.*`) and the resident SMS (`sms.*`) of
 * `identity` (DOC-26 §5.4) are in `mail/` and `sms/`; screen keys (`res.*`, `staff.*`, `web.*`) are added by the screen tasks in their own files and spread in here.
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
  'sms',
] as const

/** The first segments the screen documents own (DOC-68 §1): the web CMS, the resident app and the staff app. */
export const SCREEN_FAMILIES = ['web', 'res', 'staff'] as const

export const isMessageKey = (key: string): key is MessageKey => Object.hasOwn(en, key)
