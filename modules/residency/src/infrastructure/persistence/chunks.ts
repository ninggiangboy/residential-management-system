/** Rows per statement of a batch insert: well under the 65,535 parameters of one statement at the widest table here. */
const BATCH = 500

export function* chunks<T>(items: readonly T[]): Generator<readonly T[]> {
  for (let from = 0; from < items.length; from += BATCH) yield items.slice(from, from + BATCH)
}
