/**
 * `bun run check:authz-metadata` (AG-01, AG-02, DOC-39 §4.1): every mounted route declares its audience and its endpoint id,
 * the ids are unique and in the catalog of DOC-51 §2, and audience, idempotency and step-up equal the catalog row. No request is
 * sent and no database is needed.
 */
import { mountedApp } from './mounted-app'
import { catalogParity, compareWithCatalog, readCatalog, readRoutes } from './route-records'

const { records, problems } = readRoutes(mountedApp())
const catalog = readCatalog()
const all = [...problems, ...compareWithCatalog(records, catalog)]
const parity = catalogParity(records, catalog)

for (const problem of all) {
  console.log(`[${problem.rule}] ${problem.message}`)
  if (process.env.GITHUB_ACTIONS)
    console.log(`::error title=check:authz-metadata ${problem.rule}::${problem.message}`)
}
console.log(
  `check:authz-metadata: ${records.length} routes with metadata, ${all.length} problem(s); ` +
    `${parity.missing.length} catalog entries not mounted yet`,
)
process.exit(all.length === 0 ? 0 : 1)
