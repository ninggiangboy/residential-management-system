import type { Occupancy } from '../contracts'

/**
 * A change of occupancy across the vacancy boundary is a `unit_history` row (DOC-27 §4.1 rule 6): from `vacant` is `moved_in`,
 * to `vacant` is `moved_out`; between `occupied` and `rented` there is none.
 */
export function vacancyChange(
  from: Occupancy,
  to: Occupancy | null,
): 'moved_in' | 'moved_out' | null {
  if (to === null || to === from) return null
  if (from === 'vacant') return 'moved_in'
  return to === 'vacant' ? 'moved_out' : null
}
