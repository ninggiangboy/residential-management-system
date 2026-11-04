import type { ReactElement } from 'react'

/** DOC-66 `W-Debts`: `month` is a fee month YYYY-MM (all when absent), `overdue` the 30-day switch. */
export interface DebtsSearch {
  month?: string
  q?: string
  overdue?: boolean
  cursor?: string
}

export function DebtsPage(_props: { search: DebtsSearch }): ReactElement | null {
  return null
}
