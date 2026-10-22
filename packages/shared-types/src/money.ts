declare const vnd: unique symbol

/** An amount in đồng: an integer, never a float; the currency is always VND (DR-11, DOC-12 §9.3). */
export type Money = bigint & { readonly [vnd]: true }

/** Throws on a fraction or a value that is not finite: money never carries a decimal part. */
export function money(n: bigint | number): Money {
  if (typeof n === 'number' && !Number.isSafeInteger(n))
    throw new RangeError(`Money must be a safe integer, got ${n}`)
  return BigInt(n) as Money
}

/** JSON carries money as an integer number (DOC-50): asserted to fit `Number.MAX_SAFE_INTEGER`. */
export function moneyToJson(m: Money): number {
  if (m > BigInt(Number.MAX_SAFE_INTEGER) || m < BigInt(Number.MIN_SAFE_INTEGER))
    throw new RangeError(`Money ${m} does not fit a JSON number`)
  return Number(m)
}

/** A quantity in thousandths: `numeric(12,3)` in SQL (DOC-14 §6). */
export type QtyMilli = bigint

/** Half up, non-negative inputs: `(12345 × 15000 + 500) / 1000 = 185175` (DOC-14 §6). */
export const lineAmount = (qty: QtyMilli, unitPrice: Money): Money =>
  money((qty * unitPrice + 500n) / 1000n)
