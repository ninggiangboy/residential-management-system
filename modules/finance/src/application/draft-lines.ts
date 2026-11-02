import type { Money } from '@rms/shared-types'
import {
  type ChargeLine,
  type ChargeLineInput,
  chargeTotal,
  checkChargeLine,
} from '../domain/charge-line'
import { ChargeLinesInvalidError, ChargeTotalZeroError } from '../domain/errors'

/** A line of a draft-edit body (DOC-21 §3.2): `{ kind, itemName: { vi, en? }, quantity, unitPrice, amount?, note? }`. */
export interface DraftLineBody {
  readonly kind?: 'fee' | 'adjustment'
  readonly itemName: { readonly vi: string; readonly en?: string }
  readonly quantity?: string | number
  readonly unitPrice?: number
  readonly amount?: number
  readonly note?: string | null
}

/**
 * The lines of a draft edit through the same rules as an imported row (DOC-21 §3.2, §4.2): any broken rule is 400 with
 * `lines[i].<field>`, a total of zero or less is 422 `charge_total_zero`.
 */
export function checkDraftLines(
  body: readonly DraftLineBody[],
  newId: () => string,
): { readonly lines: (ChargeLine & { readonly id: string })[]; readonly amount: Money } {
  const lines: (ChargeLine & { readonly id: string })[] = []
  const issues: ConstructorParameters<typeof ChargeLinesInvalidError>[0][number][] = []
  body.forEach((line, index) => {
    const input: ChargeLineInput = {
      kind: line.kind ?? null,
      itemName: line.itemName.vi,
      itemNameEn: line.itemName.en ?? null,
      quantity: line.quantity ?? null,
      unitPrice: line.unitPrice ?? null,
      amount: line.amount ?? null,
      note: line.note ?? null,
    }
    const result = checkChargeLine(input)
    if (result.ok) lines.push({ ...result.line, id: newId() })
    else for (const issue of result.issues) issues.push({ index, issue })
  })
  if (issues.length > 0) throw new ChargeLinesInvalidError(issues)
  const amount = chargeTotal(lines)
  if (amount <= 0n) throw new ChargeTotalZeroError()
  return { lines, amount }
}
