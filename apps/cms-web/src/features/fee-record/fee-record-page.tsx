import type { ReactElement } from 'react'

/** DOC-66 `W-Fee-Record`: a unit's debt; `dialog` and `charge`/`payment` are kept in the URL, `payments` is the receipt-history cursor. */
export interface FeeRecordSearch {
  dialog?: 'payment' | 'void-payment' | 'void'
  charge?: string
  payment?: string
  payments?: string
}

export function FeeRecordPage(_props: {
  unitId: string
  search: FeeRecordSearch
}): ReactElement | null {
  return null
}
