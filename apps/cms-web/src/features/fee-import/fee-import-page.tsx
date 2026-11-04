import type { ReactElement } from 'react'

/** DOC-66 `W-Fee-Import`: `batchId` is the draft the lines go to (its fee month is locked, DR-265); `importId` reopens a preview (E-73). */
export interface FeeImportSearch {
  batchId?: string
  importId?: string
}

export function FeeImportPage(_props: { search: FeeImportSearch }): ReactElement | null {
  return null
}
