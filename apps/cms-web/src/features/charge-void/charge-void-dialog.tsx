import type { ReactElement } from 'react'

/** The charge a `W-Charge-Void` dialog shows: the row the host screen already holds (E-93 or E-102), no extra read (DOC-66). */
export interface VoidTarget {
  chargeId: string
  version: number
  unitCode: string
  amount: number
  batchCode?: string
  /** The unit of the charge, when the host knows it: its debt query is refreshed after the void. */
  unitId?: string
  hasActiveIntent: boolean
}

/** DOC-66 `W-Charge-Void`. `open` is true while the host's `dialog=void` is set; the host clears it in `onClose`. `target` is undefined until the row is found. */
export function ChargeVoidDialog(_props: {
  open: boolean
  target: VoidTarget | undefined
  onClose: () => void
  onVoided: () => void
}): ReactElement | null {
  return null
}
