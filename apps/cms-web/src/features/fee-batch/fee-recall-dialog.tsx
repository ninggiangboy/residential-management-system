import type { ReactElement } from 'react'

/** DOC-66 `W-Fee-Recall`; opened with `dialog=recall` on `/fees/$batchId`. */
export function FeeRecallDialog(_props: {
  open: boolean
  batchId: string
  onClose: () => void
}): ReactElement | null {
  return null
}
