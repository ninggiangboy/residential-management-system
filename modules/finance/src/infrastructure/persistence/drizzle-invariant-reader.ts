import type { Database } from '@core/db'
import { type SQL, sql } from 'drizzle-orm'
import {
  INVARIANT_SAMPLE_LIMIT,
  type InvariantFinding,
  type InvariantReader,
  type InvariantTag,
} from '../../domain/invariant-check'

/**
 * The nightly ledger check of DOC-22 §12 (DR-78, DR-266, DR-244): the nineteen queries of the doc, unchanged. One statement
 * counts the offending rows per tag over the union of the branches; each non-empty tag then answers its first
 * `INVARIANT_SAMPLE_LIMIT` ids. The SQL is the doc's: the same tables, the same predicates, and `:b` bound as `building_id`.
 */

/** One line of the counting union: the tag and how many rows it returned. */
interface CountRow {
  readonly q: string
  readonly rows: number
}

/** One sampled id; `null` for the counter rows Q05 and Q16, whose branch selects `NULL`. */
interface SampleRow {
  readonly id: string | null
}

interface InvariantBranch {
  readonly tag: InvariantTag
  readonly branch: (b: string) => SQL
}

/** The nineteen branches of DOC-22 §12, in `INVARIANT_QUERY_TAGS` order. */
const INVARIANT_BRANCHES: ReadonlyArray<InvariantBranch> = [
  {
    tag: 'Q01',
    branch: (b) =>
      sql`SELECT 'Q01' q, c.id FROM finance.charge c WHERE c.building_id = ${b} AND c.status = 'paid'
   AND EXISTS (SELECT 1 FROM finance.allocation a WHERE a.building_id = c.building_id AND a.charge_id = c.id AND a.status = 'live' AND a.amount <> c.amount)`,
  },
  {
    tag: 'Q02',
    branch: (b) =>
      sql`SELECT 'Q02', a.id FROM finance.allocation a WHERE a.building_id = ${b} AND a.status = 'live'
   AND NOT EXISTS (SELECT 1 FROM finance.payment p WHERE p.id = a.payment_id AND p.status = 'posted')`,
  },
  {
    tag: 'Q03',
    branch: (b) =>
      sql`SELECT 'Q03', a.id FROM finance.allocation a JOIN finance.charge c ON c.id = a.charge_id
   WHERE a.building_id = ${b} AND a.status = 'live' AND c.status = 'void'`,
  },
  {
    tag: 'Q04',
    branch: (b) =>
      sql`SELECT 'Q04', a.charge_id FROM finance.allocation a WHERE a.building_id = ${b} AND a.status = 'live' GROUP BY a.charge_id HAVING count(*) > 1`,
  },
  {
    tag: 'Q05',
    branch: (b) =>
      sql`SELECT 'Q05', NULL FROM finance.document_counter d WHERE d.building_id = ${b} AND d.series = 'receipt'
   AND d.last <> (SELECT count(*) FROM finance.receipt r WHERE r.building_id = d.building_id AND substr(r.number, 4, 4) = d.period)`,
  },
  {
    tag: 'Q06',
    branch: (b) =>
      sql`SELECT 'Q06', r.allocation_id FROM finance.receipt r WHERE r.building_id = ${b} GROUP BY r.allocation_id HAVING count(*) > 1`,
  },
  {
    tag: 'Q07',
    branch: (b) =>
      sql`SELECT 'Q07', r.id FROM finance.receipt r JOIN finance.allocation a ON a.id = r.allocation_id
   WHERE r.building_id = ${b} AND r.status = 'issued' AND a.status = 'void'`,
  },
  {
    tag: 'Q08',
    branch: (b) =>
      sql`SELECT 'Q08', p.id FROM finance.payment p WHERE p.building_id = ${b} AND p.status = 'posted'
   AND p.amount <> coalesce((SELECT sum(a.amount) FROM finance.allocation a WHERE a.building_id = p.building_id AND a.payment_id = p.id AND a.status = 'live'), 0)`,
  },
  {
    tag: 'Q09',
    branch: (b) =>
      sql`SELECT 'Q09', g.id FROM finance.gateway_event g WHERE g.building_id = ${b} AND g.outcome = 'posted'
   AND NOT EXISTS (SELECT 1 FROM finance.payment p WHERE p.id = g.payment_id AND p.status = 'posted')`,
  },
  {
    tag: 'Q10',
    branch: (b) =>
      sql`SELECT 'Q10', a.id FROM finance.allocation a JOIN finance.payment p ON p.id = a.payment_id JOIN finance.charge c ON c.id = a.charge_id
   WHERE a.building_id = ${b} AND p.unit_id <> c.unit_id`,
  },
  {
    tag: 'Q11',
    branch: (b) =>
      sql`SELECT 'Q11', i.id FROM finance.payment_intent i WHERE i.building_id = ${b} AND i.status = 'paid'
   AND NOT EXISTS (SELECT 1 FROM finance.payment p WHERE p.building_id = i.building_id AND p.intent_id = i.id AND p.status = 'posted')`,
  },
  {
    tag: 'Q12',
    branch: (b) =>
      sql`SELECT 'Q12', p.id FROM finance.payment p WHERE p.building_id = ${b} AND p.source = 'online'
   AND NOT EXISTS (SELECT 1 FROM finance.payment_intent i WHERE i.id = p.intent_id AND i.status = 'paid')`,
  },
  {
    tag: 'Q13',
    branch: (b) =>
      sql`SELECT 'Q13', it.charge_id FROM finance.payment_intent_item it WHERE it.building_id = ${b} AND it.released_at IS NULL GROUP BY it.charge_id HAVING count(*) > 1`,
  },
  {
    tag: 'Q14',
    branch: (b) =>
      sql`SELECT 'Q14', c.id FROM finance.charge c WHERE c.building_id = ${b} AND c.status = 'paid'
   AND NOT EXISTS (SELECT 1 FROM finance.allocation a WHERE a.building_id = c.building_id AND a.charge_id = c.id AND a.status = 'live')`,
  },
  {
    tag: 'Q15',
    branch: (b) =>
      sql`SELECT 'Q15', a.id FROM finance.allocation a JOIN finance.charge c ON c.id = a.charge_id
   WHERE a.building_id = ${b} AND a.status = 'live' AND c.status IN ('draft', 'open')`,
  },
  {
    tag: 'Q16',
    branch: (b) =>
      sql`SELECT 'Q16', NULL FROM finance.document_counter d WHERE d.building_id = ${b} AND d.series = 'receipt'
   AND d.last < (SELECT coalesce(max(substr(r.number, 9)::int), 0) FROM finance.receipt r WHERE r.building_id = d.building_id AND substr(r.number, 4, 4) = d.period)`,
  },
  {
    tag: 'Q17',
    branch: (b) =>
      sql`SELECT 'Q17', a.id FROM finance.allocation a WHERE a.building_id = ${b} AND a.status = 'live'
   AND NOT EXISTS (SELECT 1 FROM finance.receipt r WHERE r.building_id = a.building_id AND r.allocation_id = a.id AND r.status = 'issued')`,
  },
  {
    tag: 'Q18',
    branch: (b) =>
      sql`SELECT 'Q18', c.id FROM finance.charge c WHERE c.building_id = ${b} AND c.status IN ('open', 'paid')
   AND c.amount <> coalesce((SELECT sum(l.amount) FROM finance.charge_line l WHERE l.building_id = c.building_id AND l.charge_id = c.id), 0)`,
  },
  {
    tag: 'Q19',
    branch: (b) =>
      sql`SELECT 'Q19', g.id FROM finance.gateway_event g WHERE g.building_id = ${b} AND g.outcome = 'pending'`,
  },
]

/**
 * The Drizzle adapter of the nightly ledger check (DOC-22 §12). It uses the ambient executor like the other repositories and
 * opens no transaction: the job owns the `REPEATABLE READ READ ONLY` one (DOC-38 §4, NFR-09).
 */
export class DrizzleInvariantReader implements InvariantReader {
  constructor(private readonly database: Database) {}

  async check(buildingId: string): Promise<readonly InvariantFinding[]> {
    const union = sql.join(
      INVARIANT_BRANCHES.map((spec) => spec.branch(buildingId)),
      sql` UNION ALL `,
    )
    const rows = (await this.database.executor.execute(
      sql`SELECT q, count(*)::int AS rows FROM (${union}) x GROUP BY q ORDER BY q`,
    )) as unknown as CountRow[]
    const findings: InvariantFinding[] = []
    for (const row of rows) {
      const spec = INVARIANT_BRANCHES.find((branch) => branch.tag === row.q)
      const count = Number(row.rows)
      if (!spec || count <= 0) continue
      const samples = (await this.database.executor.execute(
        sql`WITH x(q, id) AS (${spec.branch(buildingId)}) SELECT id::text AS id FROM x LIMIT ${INVARIANT_SAMPLE_LIMIT}`,
      )) as unknown as SampleRow[]
      findings.push({ tag: spec.tag, rows: count, sampleIds: samples.map((s) => s.id) })
    }
    return findings
  }
}
