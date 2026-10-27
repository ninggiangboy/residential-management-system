import type { Language } from '@rms/shared-types'
import type { Messages } from './catalog'
import { en as sharedEn } from './shared/en'
import { vi as sharedVi } from './shared/vi'
import { webEn } from './web/en'
import { webVi } from './web/vi'

/**
 * What the web CMS shows: the shared families and `web.*`. The mails, the SMS and the import issues are rendered by the API, and
 * `res.*` and `staff.*` belong to the apps, so none of them is in the web bundle (DOC-53 §8, DR-179).
 */
export const WEB_CATALOGS: Readonly<Record<Language, Partial<Messages>>> = {
  vi: { ...sharedVi, ...webVi },
  en: { ...sharedEn, ...webEn },
}
