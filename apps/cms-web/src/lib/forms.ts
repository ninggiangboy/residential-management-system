import { typeboxResolver } from '@hookform/resolvers/typebox'
import type { ApiError } from '@rms/client-core'
import type { TObject, TSchema } from '@sinclair/typebox'
import { ValueErrorType } from '@sinclair/typebox/errors'
import type { FieldErrors, FieldValues, Path, Resolver, UseFormReturn } from 'react-hook-form'
import type { T } from './i18n'

/**
 * The request schema of the API is the form schema (DOC-55 §14); a client-side failure shows the catalog sentence of its rule
 * code (DOC-68 §3.7), the one the server would send for the same rule, not TypeBox's English.
 */
export function formResolver<Values extends FieldValues>(schema: TObject, t: T): Resolver<Values> {
  const base = typeboxResolver(schema) as unknown as Resolver<Values>
  return (async (values, context, options) => {
    const result = await base(values, context, options)
    return { ...result, errors: localize(result.errors, schema, values, t) }
  }) as Resolver<Values>
}

/** The sentence of a TypeBox error: its rule code of DOC-68 §3.7, with the limit read from the field's schema. */
function ruleText(type: number, field: TSchema | undefined, value: unknown, t: T): string {
  const blank = typeof value === 'string' && value.trim() === ''
  switch (type) {
    case ValueErrorType.StringMinLength:
      return blank || field?.minLength === 1
        ? t('error.required')
        : t('error.min_length', { min: field?.minLength })
    case ValueErrorType.StringMaxLength:
      return t('error.max_length', { max: field?.maxLength })
    case ValueErrorType.StringPattern:
      return blank ? t('error.required') : t('error.format')
    case ValueErrorType.StringFormat:
      return t('error.format')
    case ValueErrorType.NumberMinimum:
      return t('error.minimum', { min: field?.minimum })
    case ValueErrorType.NumberMaximum:
      return t('error.maximum', { max: field?.maximum })
    case ValueErrorType.Union:
    case ValueErrorType.Literal:
      return t('error.enum')
    default:
      return t('error.validation_failed')
  }
}

function localize(
  errors: FieldErrors,
  schema: TSchema | undefined,
  values: unknown,
  t: T,
): FieldErrors {
  const out: Record<string, unknown> = {}
  const fields = (schema?.properties ?? {}) as Record<string, TSchema>
  const at = (key: string) =>
    typeof values === 'object' && values !== null
      ? (values as Record<string, unknown>)[key]
      : undefined
  for (const [key, value] of Object.entries(errors)) {
    if (typeof value === 'object' && value !== null && 'type' in value)
      out[key] = { ...value, message: ruleText(Number(value.type), fields[key], at(key), t) }
    else if (typeof value === 'object' && value !== null)
      out[key] = localize(value as FieldErrors, fields[key], at(key), t)
  }
  return out as FieldErrors
}

interface Detail {
  path: string
  code: string
  message: string
}

/**
 * `validation_failed` → the field of each `details[].path`, with the message the server rendered in the caller's language
 * (DOC-55 §14). Returns the text for the form banner when a path matches no field (a `header.…` path, an unknown one).
 */
export function applyServerErrors<Values extends FieldValues>(
  form: UseFormReturn<Values>,
  error: Pick<ApiError, 'code' | 'details' | 'message'>,
  fields: readonly string[],
  fallback: string,
): string | null {
  if (error.code !== 'validation_failed' || !Array.isArray(error.details)) return null
  let unmatched = false
  let first = true
  for (const detail of error.details as Detail[]) {
    const path = detail.path.split(':')[0] ?? ''
    if (fields.includes(path)) {
      form.setError(
        path as Path<Values>,
        { type: detail.code, message: detail.message || fallback },
        { shouldFocus: first },
      )
      first = false
    } else unmatched = true
  }
  return unmatched || first ? fallback : null
}
