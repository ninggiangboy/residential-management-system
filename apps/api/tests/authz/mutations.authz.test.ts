import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { MUTANTS, type MutantResult, runMutants } from './mutations'
import { buildWorld, type World } from './world'

/**
 * The baseline of EXP-10 (§3): each of the eleven defective guards is caught with the expected reason. A surviving mutant fails
 * the experiment (C7). `AUTHZ_MUTANTS=M2,M7` runs some of them.
 */

const ids = process.env.AUTHZ_MUTANTS?.split(',').map((id) => id.trim())
let world: World
const results = new Map<string, MutantResult>()

beforeAll(async () => {
  world = await buildWorld()
  for (const result of await runMutants(world, ids)) results.set(result.id, result)
}, 300_000)
afterAll(async () => {
  await world?.db.drop()
})

describe('the generator can fail', () => {
  for (const mutant of MUTANTS) {
    const title =
      mutant.id === 'M2'
        ? `SC-04 EXP-10 M2 ${mutant.title}`
        : mutant.id === 'M3'
          ? `SC-05 EXP-10 M3 ${mutant.title}`
          : `EXP-10 ${mutant.id} ${mutant.title}`
    test(title, () => {
      if (ids !== undefined && !ids.includes(mutant.id)) return
      const result = results.get(mutant.id)
      expect(result?.detail).not.toBe('the run stayed green')
      expect(result?.caught).toBe(true)
    })
  }

  test('C7 11 of 11 mutants caught', () => {
    if (ids !== undefined) return
    expect(MUTANTS).toHaveLength(11)
    expect([...results.values()].filter((r) => r.caught)).toHaveLength(11)
  })
})
