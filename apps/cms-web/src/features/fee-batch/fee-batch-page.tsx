import type { ReactElement } from 'react'

/** DOC-66 `W-Fee-Batch`: the dialogs are kept in the URL (`dialog`, with `charge` for a single void) and unmounted through `useExit`. */
export interface FeeBatchSearch {
  view: 'all' | 'missing'
  q?: string
  unit?: string
  dialog?: 'recall' | 'void' | 'reissue' | 'extend' | 'publish' | 'discard' | 'close'
  charge?: string
  cursor?: string
}

export function FeeBatchPage(_props: {
  batchId: string
  search: FeeBatchSearch
}): ReactElement | null {
  return null
}
