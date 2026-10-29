import type { Messages } from './catalog'
import { vi as sharedVi } from './shared/vi'
import { webVi } from './web/vi'

/** The web CMS in Vietnamese, the default language (DR-71): in the bundle every page loads. */
export const WEB_VI: Partial<Messages> = { ...sharedVi, ...webVi }
