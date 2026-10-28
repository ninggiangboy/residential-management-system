import {
  isUsageName,
  type UsageApp,
  type UsageEventKind,
  type UsageName,
  type UsagePlatform,
} from '@rms/shared-types'

/** One event of a batch as the route validated its form (DOC-104 §6.2); the name is not yet checked against the lists. */
export interface UsageEventInput {
  event: UsageEventKind
  name: string
  /** Milliseconds between the event and the moment the client sent the batch. */
  ageMs: number
  /** `app_close` only. */
  durationSec?: number
}

/** The body of E-173 and E-174 after the schema (DOC-104 §6.2). `audience` is the kind of the token, never the body's. */
export interface UsageBatch {
  app: UsageApp
  appVersion: string
  platform: UsagePlatform
  sessionId: string
  events: readonly UsageEventInput[]
}

export interface BatchIssue {
  path: string
  code: string
  message: string
}

/**
 * The rules that a schema cannot say (DOC-104 §6.2): `durationSec` is required on `app_close` and refused on any other event, and
 * the session id is a UUID of version 4. A finding is a 400 `validation_failed`.
 */
export function batchIssues(batch: UsageBatch): BatchIssue[] {
  const issues: BatchIssue[] = []
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batch.sessionId)
  )
    issues.push({ path: 'sessionId', code: 'format', message: 'must be a UUID v4' })
  batch.events.forEach((event, index) => {
    const closing = event.event === 'app_close'
    if (closing && event.durationSec === undefined)
      issues.push({
        path: `events.${index}.durationSec`,
        code: 'required',
        message: 'required on app_close',
      })
    if (!closing && event.durationSec !== undefined)
      issues.push({
        path: `events.${index}.durationSec`,
        code: 'not_allowed',
        message: 'only app_close carries durationSec',
      })
  })
  return issues
}

/** An event that passed the lists, ready to be written. */
export interface UsageRow {
  id: string
  event: UsageEventKind
  name: UsageName
  ageMs: number
  /** `null` for every event but `app_close`. */
  durationS: number | null
}

/**
 * Keeps the events whose name is in the lists of its kind and counts the others (DOC-104 §6.1 step 8): a client can be old, new or
 * modified, and a name outside the lists is dropped, never refused.
 */
export function splitByLists(
  events: readonly UsageEventInput[],
  nextId: () => string,
): { kept: UsageRow[]; dropped: number } {
  const kept: UsageRow[] = []
  let dropped = 0
  for (const input of events) {
    if (!isUsageName(input.event, input.name)) {
      dropped++
      continue
    }
    kept.push({
      id: nextId(),
      event: input.event,
      name: input.name,
      ageMs: input.ageMs,
      durationS: input.event === 'app_close' ? (input.durationSec ?? 0) : null,
    })
  }
  return { kept, dropped }
}
