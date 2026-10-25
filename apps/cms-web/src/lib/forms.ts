import { typeboxResolver } from '@hookform/resolvers/typebox'
import type { ApiError } from '@rms/client-core'
import type { TObject } from '@sinclair/typebox'
import type { FieldErrors, FieldValues, Path, Resolver, UseFormReturn } from 'react-hook-form'
import type { T } from './i18n'

/** The request schema of the API is the form schema (DOC-55 §14); a client-side failure shows the catalog sentence, not TypeBox's English. */
export function formResolver<Values extends FieldValues>(schema: TObject, t: T): Resolver<Values> {
  const base = typeboxResolver(schema) as unknown as Resolver<Values>
  return (async (values, context, options) => {
    const result = await base(values, context, options)
    return { ...result, errors: localize(result.errors, t) }
  }) as Resolver<Values>
}

function localize(errors: FieldErrors, t: T): FieldErrors {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(errors)) {
    if (typeof value === 'object' && value !== null && 'type' in value)
      out[key] = { ...value, message: t('error.validation_failed') }
    else if (typeof value === 'object' && value !== null)
      out[key] = localize(value as FieldErrors, t)
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
