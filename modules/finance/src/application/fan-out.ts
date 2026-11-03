import { FAN_OUT_CHUNK } from '../contracts'

/** One message of a chunked fan-out (DOC-09 §3.4): positions from 1, at most 500 unit ids each. */
export interface UnitChunk {
  readonly part: number
  readonly parts: number
  readonly unitIds: string[]
}

/** 1,201 units are three parts of 500, 500 and 201 (DOC-21 §2.2, MC-06); no unit is no part. */
export function unitChunks(unitIds: readonly string[], size = FAN_OUT_CHUNK): UnitChunk[] {
  const parts = Math.ceil(unitIds.length / size)
  return Array.from({ length: parts }, (_, i) => ({
    part: i + 1,
    parts,
    unitIds: unitIds.slice(i * size, (i + 1) * size),
  }))
}

/** `YYYY-MM` of a fee month `YYYY-MM-01`, as the batch events carry it (DOC-09 §6.1). */
export const monthOf = (feeMonth: string): string => feeMonth.slice(0, 7)
