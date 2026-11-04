import type { Language } from '@rms/shared-types'
import type { Messages } from './catalog'
import { WEB_EN } from './web-en'
import { WEB_FINANCE_EN } from './web-finance-en'
import { WEB_FINANCE_VI } from './web-finance-vi'
import { WEB_VI } from './web-vi'

/**
 * What the web CMS shows: the shared families and `web.*`. The mails, the SMS and the import issues are rendered by the API, and
 * `res.*` and `staff.*` belong to the apps, so none of them is in the web bundle (DOC-53 §8, DR-179). Both languages at once,
 * with the feature chunks (finance) merged in, for the tests; the web entry (`./web`) loads English only when it is asked for (DR-308).
 */
export const WEB_CATALOGS: Readonly<Record<Language, Partial<Messages>>> = {
  vi: { ...WEB_VI, ...WEB_FINANCE_VI },
  en: { ...WEB_EN, ...WEB_FINANCE_EN },
}
