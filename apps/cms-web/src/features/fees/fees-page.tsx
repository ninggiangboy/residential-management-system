import type { ReactElement } from 'react'

/** DOC-66 `W-Fees`: the search parameters of `/fees` (cursor stack: one page per status, DR-324). */
export interface FeesSearch {
  status: 'all' | 'draft' | 'published' | 'closed' | 'recalled'
  month?: string
  q?: string
  cursor?: string
  limit: number
}

export function FeesPage(_props: { search: FeesSearch }): ReactElement | null {
  return null
}
