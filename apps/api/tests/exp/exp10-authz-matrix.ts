/**
 * `bun run exp:10` (EXP-10, DOC-99 §5, DOC-88 §12): five runs of the full matrix, the step-up pass and the eleven mutants on one
 * commit; one result file per run and a summary. The results of record come from the CI job `integration` (DR-173); a run on a
 * developer machine describes the machine in the file.
 */
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, platform, release, totalmem } from 'node:os'
import { resolve } from 'node:path'
import { metricsOf, runMatrix } from '../authz/matrix'
import { mountedApp } from '../authz/mounted-app'
import { runMutants } from '../authz/mutations'
import { catalogParity, compareWithCatalog, readCatalog, readRoutes } from '../authz/route-records'
import { runStepUpPass } from '../authz/stepup'
import { buildWorld } from '../authz/world'

const RUNS = 5
const RESULTS = resolve(import.meta.dir, '../../../../docs/10-testing/experiments/results')
const stamp = `${new Date().toISOString().slice(0, 16).replace(/[-:]/g, '')}Z`
new Date().toISOString().replace(/[-:]/g, '').slice(0, 13) +
  new Date().toISOString().slice(14, 16) +
  'Z'
const git = (args: string) => {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

interface Criterion {
  id: string
  expected: string
  observed: string | number | boolean
  pass: boolean
}

mkdirSync(RESULTS, { recursive: true })
const summary: Array<{ run: number; metrics: Record<string, unknown>; pass: boolean }> = []
const hashes: string[] = []

for (let run = 1; run <= RUNS; run++) {
  const startedAt = new Date()
  const { records, problems } = readRoutes(mountedApp())
  const catalog = readCatalog()
  const catalogProblems = compareWithCatalog(records, catalog)
  const parity = catalogParity(records, catalog)
  const world = await buildWorld()
  try {
    const { cells, missingFixtures } = await runMatrix(world, records)
    const matrix = metricsOf(cells, records.length, missingFixtures)
    const stepUp = await runStepUpPass(world)
    const mutants = await runMutants(world)
    hashes.push(matrix.matrixSha256)
    const caught = mutants.filter((m) => m.caught).length
    const metrics = {
      routes: records.length,
      routesWithMetadata: records.length,
      catalogParity: { missing: parity.missing.length, extra: parity.extra },
      cellsOwn: matrix.cellsOwn,
      cellsForeign: matrix.cellsForeign,
      unexpected2xx: matrix.unexpected2xx,
      unexpectedRefusals: matrix.unexpectedRefusals + matrix.wrongRefusals,
      serverErrors: matrix.serverErrors,
      leaks: matrix.leaks,
      missingFixtures: matrix.missingFixtures,
      mutants: {
        run: mutants.length,
        caught,
        survivors: mutants.filter((m) => !m.caught).map((m) => m.id),
      },
      stepUp: { cases: stepUp.cases.length, failures: stepUp.failures.length },
      matrixSha256: matrix.matrixSha256,
    }
    const criteria: Criterion[] = [
      {
        id: 'C1',
        expected: '0',
        observed: metrics.unexpected2xx,
        pass: metrics.unexpected2xx === 0,
      },
      {
        id: 'C2',
        expected: '0',
        observed: metrics.unexpectedRefusals,
        pass: metrics.unexpectedRefusals === 0,
      },
      { id: 'C3', expected: '0', observed: metrics.serverErrors, pass: metrics.serverErrors === 0 },
      { id: 'C4', expected: '0', observed: metrics.leaks, pass: metrics.leaks === 0 },
      {
        id: 'C5',
        expected: '100%, 0, 0',
        observed: `${problems.length + catalogProblems.length} problems, ${parity.extra.length} extra, ${matrix.missingFixtures} missing fixtures`,
        pass:
          problems.length +
            catalogProblems.length +
            parity.extra.length +
            matrix.missingFixtures ===
          0,
      },
      { id: 'C7', expected: '11', observed: caught, pass: caught === 11 },
      {
        id: 'C8',
        expected: '0',
        observed: stepUp.failures.length,
        pass: stepUp.failures.length === 0,
      },
    ]
    const result = {
      experiment: 'EXP-10',
      run,
      of: RUNS,
      commit: git('rev-parse --short HEAD'),
      dirty: (git('status --porcelain')?.length ?? 0) > 0,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      machine: {
        host: process.env.CI ? 'ci' : 'developer machine',
        cpu: `${cpus().length} × ${cpus()[0]?.model ?? 'cpu'}`,
        ramGb: Math.round(totalmem() / 2 ** 30),
        os: `${platform()} ${release()}`,
      },
      runtime: { bun: Bun.version, postgres: '18.6', api: git('rev-parse --short HEAD') },
      metrics,
      criteria,
      pass: criteria.every((c) => c.pass),
    }
    writeFileSync(
      resolve(RESULTS, `EXP-10-${stamp}-run${run}.json`),
      `${JSON.stringify(result, null, 2)}\n`,
    )
    summary.push({ run, metrics, pass: result.pass })
    console.log(
      `run ${run}/${RUNS}: ${result.pass ? 'pass' : 'FAIL'}  ${JSON.stringify(criteria.map((c) => [c.id, c.observed]))}`,
    )
  } finally {
    await world.db.drop()
  }
}

const deterministic = new Set(hashes).size === 1
const pass = summary.every((s) => s.pass) && deterministic
writeFileSync(
  resolve(RESULTS, `EXP-10-${stamp}-summary.json`),
  `${JSON.stringify({ experiment: 'EXP-10', commit: git('rev-parse --short HEAD'), runs: summary, deterministic: { pass: deterministic, hashes }, pass }, null, 2)}\n`,
)
console.log(`EXP-10: ${pass ? 'pass' : 'FAIL'} (deterministic: ${deterministic})`)
process.exit(pass ? 0 : 1)
