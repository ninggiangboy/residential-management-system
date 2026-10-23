import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { runStepUpPass, type StepUpCase } from './stepup'
import { buildWorld, type World } from './world'

/** EXP-10 §7.1 (C8): the step-up cases of E-40, E-42 and E-50, and the rows of E-38 and the other actors. */

let world: World
let cases: StepUpCase[] = []

beforeAll(async () => {
  world = await buildWorld()
  cases = (await runStepUpPass(world)).cases
}, 300_000)
afterAll(async () => {
  await world?.db.drop()
})

describe('the step-up pass', () => {
  test('SC-08 every case of the table of EXP-10 §7.1 equals its row: 0 failures, and no 2xx among S0 to S8', () => {
    expect(cases.length).toBeGreaterThanOrEqual(50)
    expect(
      cases.filter((c) => !c.ok).map((c) => `${c.id} ${c.variant} ${c.title}: ${c.detail}`),
    ).toEqual([])
  })

  test('the ten states run against each of the four variants', () => {
    for (const variant of ['E-40 admin', 'E-42 promote', 'E-42 email', 'E-50 gateway'])
      expect(
        cases
          .filter((c) => c.variant === variant && c.id.startsWith('S'))
          .map((c) => c.id)
          .sort(),
      ).toEqual(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'])
  })
})
