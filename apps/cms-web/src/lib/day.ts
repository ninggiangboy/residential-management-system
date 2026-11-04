/**
 * A calendar day as text. The API answers `LocalDate` as `YYYY-MM-DD`, but Eden Treaty revives every such string into a `Date`
 * (its default `parseDate`), while the screens slice, compare and bind the value as text (DOC-66 §4, DR-09).
 */
export const day = (value: string | Date): string =>
  (typeof value === 'string' ? value : value.toISOString()).slice(0, 10)
