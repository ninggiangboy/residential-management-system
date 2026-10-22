import type { Language } from '@rms/shared-types'
import { en } from './shared/en'
import { vi } from './shared/vi'

/**
 * The message catalog of the whole product (DR-71, DOC-68): one flat map of ICU messages per language, keyed by the
 * dotted key of DOC-68 §1. The shared families live in `shared/`; screen keys (`res.*`, `staff.*`, `web.*`) are added
 * by the screen tasks in their own files and spread in here.
 */
export type MessageKey = keyof typeof en
export type Messages = Readonly<Record<MessageKey, string>>

export const CATALOGS: Readonly<Record<Language, Messages>> = { vi, en }

/** The first segments a shared key may have; any other first segment belongs to a screen document (DOC-68 §1). */
export const SHARED_FAMILIES = ['error', 'status', 'common', 'auth', 'offline', 'upgrade'] as const

export const isMessageKey = (key: string): key is MessageKey => Object.hasOwn(en, key)
