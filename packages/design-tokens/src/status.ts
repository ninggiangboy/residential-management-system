import table from '../status.json' with { type: 'json' }
import type { IconName, Tone } from './icons'

export type Audience = 'any' | 'resident' | 'staff'

/** One way a domain value is shown: tone, icon and the catalog key of its label (DR-183, DOC-54 §6). */
export interface StatusRow {
  readonly entity: string
  readonly value: string
  /** A derived condition when one value is shown several ways (an open charge by its due date). */
  readonly when?: string
  readonly audience: Audience
  readonly tone: Tone
  readonly icon: IconName | null
  readonly label: string
  /** A second key shown beside the label ("Còn {count} ngày"). */
  readonly detail?: string
}

export const STATUS_ROWS = table.rows as readonly StatusRow[]

/** The row for a value as one audience sees it; `when` picks among the rows of a derived condition. */
export function statusRow(
  entity: string,
  value: string,
  audience: Exclude<Audience, 'any'>,
  when?: string,
): StatusRow | undefined {
  const matches = STATUS_ROWS.filter(
    (r) => r.entity === entity && r.value === value && (r.when === undefined || r.when === when),
  )
  return matches.find((r) => r.audience === audience) ?? matches.find((r) => r.audience === 'any')
}
