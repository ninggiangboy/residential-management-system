import { ConflictError } from './errors'

/**
 * A state change that an aggregate decided (DR-255): the rule ran in the domain, and one conditional statement applies it.
 * `expect` is the part of the state the rule read, `set` the new state of the changed fields. A repository applies it as
 * `UPDATE … SET <set> WHERE id = :id AND <expect>`; no row means another actor moved the state first.
 */
export interface Transition<S extends object> {
  readonly id: string
  readonly expect: Partial<S>
  readonly set: Partial<S>
}

/** One try of `decide`: `done` with the answer, or `done: false` when the guarded statement found the state moved. */
export type Decision<R> = { done: true; value: R } | { done: false }

/** How many times `decide` loads and decides again before it gives up (DR-255 item 3). */
export const MAX_DECIDE_ATTEMPTS = 30

/**
 * For a change that every actor must get counted (a wrong password): load, decide, apply, and when the guarded statement lost a
 * race, load again and decide on the state the winner left. The bound keeps a hot row from looping.
 */
export async function decide<R>(
  attempt: () => Promise<Decision<R>>,
  maxAttempts = MAX_DECIDE_ATTEMPTS,
): Promise<R> {
  for (let tried = 0; tried < maxAttempts; tried++) {
    const decision = await attempt()
    if (decision.done) return decision.value
  }
  throw new ConflictError('conflict', 'The state kept changing, try again')
}
