import type { ReactElement } from 'react'

/** DOC-66 `W-Fee-Reissue`; opened with `dialog=reissue` on `/fees/$batchId`. It navigates to the new draft itself. */
export function FeeReissueDialog(_props: {
  open: boolean
  batchId: string
  onClose: () => void
}): ReactElement | null {
  return null
}
