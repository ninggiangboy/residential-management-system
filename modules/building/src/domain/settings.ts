import { RuleViolationError } from '@core/kernel'
import {
  type BuildingSettings,
  DEFAULT_SETTINGS,
  SETTING_RULES,
  type SettingPath,
  type SettingsPatch,
} from '../contracts'

/** One field of a diff, the shape the audit row wants (the application layer hands it to `AuditApi` as it is). */
export interface FieldChange {
  field: string
  before: string | number | boolean | null
  after: string | number | boolean | null
}

type Rule = (typeof SETTING_RULES)[SettingPath]

/** `null` when the value is within the rule, else the reason, for the log of a stored value that fails. */
function breach(rule: Rule, value: unknown): string | null {
  if ('oneOf' in rule) return (rule.oneOf as readonly unknown[]).includes(value) ? null : 'enum'
  if (typeof value !== 'number' || !Number.isInteger(value)) return 'type'
  return value < rule.min || value > rule.max ? 'range' : null
}

const valueAt = (source: Record<string, unknown>, path: string): unknown => {
  const [head, tail] = path.split('.') as [string, string | undefined]
  const value = source[head]
  return tail === undefined ? value : (value as Record<string, unknown> | undefined)?.[tail]
}

/**
 * The saved keys overlaid on the code defaults (DR-111). A stored value that fails its rule falls back to its default, so a
 * hand-edited row cannot break a request; `onInvalid` lets the caller log it at `error`.
 */
export function resolveSettings(
  saved: Record<string, unknown>,
  onInvalid?: (path: string, reason: string) => void,
): BuildingSettings {
  const out = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>
  for (const path of Object.keys(SETTING_RULES) as SettingPath[]) {
    const stored = valueAt(saved, path)
    if (stored === undefined) continue
    const reason = breach(SETTING_RULES[path], stored)
    if (reason) {
      onInvalid?.(path, reason)
      continue
    }
    const [head, tail] = path.split('.') as [string, string | undefined]
    if (tail === undefined) out[head] = stored
    else (out[head] as Record<string, unknown>)[tail] = stored
  }
  const columns = saved.reportColumns
  if (columns && typeof columns === 'object' && !Array.isArray(columns))
    out.reportColumns = columns as Record<string, string[]>
  return out as unknown as BuildingSettings
}

/** The range of every key in a patch; 422 `validation_failed`, rule `setting_invalid`, with the path `settings.<key>` (FR-38.2). */
export function assertPatchInRange(patch: SettingsPatch): void {
  for (const path of Object.keys(SETTING_RULES) as SettingPath[]) {
    const value = valueAt(patch as Record<string, unknown>, path)
    if (value === undefined || value === null) continue
    if (breach(SETTING_RULES[path], value))
      throw new RuleViolationError(
        'setting_invalid',
        `The setting ${path} is out of range`,
        `settings.${path}`,
      )
  }
}

export interface SettingsMerge {
  /** Keys to set, as JSON: the right-hand side of `data || :set`. */
  set: Record<string, unknown>
  /** Keys sent as `null`: removed from `data`, so they fall back to the default. */
  remove: string[]
  /** `data` after the merge, for the response and for the diff. */
  data: Record<string, unknown>
  changes: FieldChange[]
}

const asAudit = (value: unknown): string | number | boolean | null =>
  value === null || value === undefined
    ? null
    : typeof value === 'object'
      ? JSON.stringify(value)
      : (value as string | number | boolean)

/**
 * A shallow merge: a key present is set, a key with `null` is removed and falls back to its default, a key absent is left alone
 * (DOC-36 §4.1). The diff lists the keys whose effective value changes, `lockout` flattened to its two members.
 */
export function mergeSettings(saved: Record<string, unknown>, patch: SettingsPatch): SettingsMerge {
  const set: Record<string, unknown> = {}
  const remove: string[] = []
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) remove.push(key)
    else if (value !== undefined) set[key] = value
  }
  const data: Record<string, unknown> = { ...saved, ...set }
  for (const key of remove) delete data[key]

  const before = resolveSettings(saved) as unknown as Record<string, unknown>
  const after = resolveSettings(data) as unknown as Record<string, unknown>
  const changes: FieldChange[] = []
  const fields = [
    ...Object.keys(DEFAULT_SETTINGS).filter((key) => key !== 'lockout'),
    'lockout.maxAttempts',
    'lockout.minutes',
  ]
  for (const field of fields) {
    const was = valueAt(before, field)
    const now = valueAt(after, field)
    if (JSON.stringify(was) !== JSON.stringify(now))
      changes.push({ field, before: asAudit(was), after: asAudit(now) })
  }
  return { set, remove, data, changes }
}
