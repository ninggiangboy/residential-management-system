/**
 * The nightly ledger check of DOC-22 §12 (DR-78 lists the twenty corruptions, DR-266 injects them, DR-244 has the job loop
 * over the buildings): the nineteen queries Q01…Q19. A pure port (DOC-12 §4.5); the Drizzle adapter is in
 * `infrastructure/persistence/`.
 */
export const INVARIANT_QUERY_TAGS = [
  'Q01',
  'Q02',
  'Q03',
  'Q04',
  'Q05',
  'Q06',
  'Q07',
  'Q08',
  'Q09',
  'Q10',
  'Q11',
  'Q12',
  'Q13',
  'Q14',
  'Q15',
  'Q16',
  'Q17',
  'Q18',
  'Q19',
] as const
export type InvariantTag = (typeof INVARIANT_QUERY_TAGS)[number]

/** The rows logged per non-empty query (DOC-22 §12). */
export const INVARIANT_SAMPLE_LIMIT = 50

/**
 * One non-empty query: how many rows offend, and the first `INVARIANT_SAMPLE_LIMIT` ids (`null` for the counter rows Q05
 * and Q16, whose branch selects `NULL`).
 */
export interface InvariantFinding {
  readonly tag: InvariantTag
  readonly rows: number
  readonly sampleIds: readonly (string | null)[]
}

/** DOC-22 §12: run the nineteen queries for one building; only the non-empty ones, ordered by tag. */
export interface InvariantReader {
  check(buildingId: string): Promise<readonly InvariantFinding[]>
}
