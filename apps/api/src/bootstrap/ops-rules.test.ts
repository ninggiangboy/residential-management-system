import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { JOB_CATALOG } from './job-catalog'

const read = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')

interface Rule {
  alert?: string
  record?: string
  expr: string
  labels?: Record<string, string>
  annotations?: Record<string, string>
}
const rulesOf = (path: string): Rule[] =>
  (Bun.YAML.parse(read(path)) as { groups: Array<{ rules: Rule[] }> }).groups.flatMap(
    (group) => group.rules,
  )

describe('OB-07: the job thresholds of DOC-40 §5.4 are the jobs of DOC-38 §4.1', () => {
  test('one stale-after value for each job of the catalog, and none more', () => {
    const recorded = rulesOf('ops/prometheus/rules/rms-jobs.yml')
      .filter((rule) => rule.record === 'job_stale_after_seconds')
      .map((rule) => rule.labels?.job_name)
    expect(recorded).toHaveLength(24)
    expect([...recorded].sort()).toEqual(JOB_CATALOG.map((job) => job.name).sort())
  })
})

describe('OB-06: every alert names a runbook', () => {
  const alerts = [
    ...rulesOf('ops/prometheus/rules/rms-alerts.yml'),
    ...rulesOf('ops/prometheus/rules/rms-jobs.yml'),
  ].filter((rule) => rule.alert)

  test('a runbook path of RB-01…13, or the table of DOC-74', () => {
    for (const alert of alerts) {
      const runbook = alert.annotations?.runbook
      expect(runbook, alert.alert).toMatch(
        /^(docs\/09-operations\/runbooks\/RB-(0[1-9]|1[0-3])-[a-z-]+\.md|table of DOC-74)$/,
      )
    }
  })

  test('a severity of critical or warning, and a summary', () => {
    for (const alert of alerts) {
      expect(['critical', 'warning'], alert.alert).toContain(alert.labels?.severity ?? '')
      expect(alert.annotations?.summary, alert.alert).toBeTruthy()
    }
  })

  // The runbooks are written with P2-20 and P3-09; until then the path is the planned one. Turn this on with the runbooks.
  test.todo('the file named by the runbook exists (P2-20)')
})
