import type { ReactElement } from 'react'

/** DOC-66 `W-Fee-Notice`: `unit` is the unit code shown (default the first), `lang` the notice language (default the building's `feeNoticeLanguage`). */
export interface FeeNoticeSearch {
  unit?: string
  lang?: 'vi' | 'en' | 'both'
}

export function FeeNoticePage(_props: {
  batchId: string
  search: FeeNoticeSearch
}): ReactElement | null {
  return null
}
