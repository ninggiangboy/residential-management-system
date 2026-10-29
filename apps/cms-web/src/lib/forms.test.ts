import { describe, expect, test } from 'bun:test'
import { createTranslator } from '@rms/i18n-catalog/web'
import { Type } from '@sinclair/typebox'
import type { FieldErrors, ResolverOptions } from 'react-hook-form'
import { formResolver } from './forms'

const Schema = Type.Object({
  code: Type.String({ minLength: 1, maxLength: 8, pattern: '\\S' }),
  reason: Type.String({ minLength: 5 }),
  floor: Type.String({ pattern: '^-?\\d{0,3}$' }),
  occupancy: Type.Union([Type.Literal('occupied'), Type.Literal('vacant')]),
})

const t = createTranslator('vi')
const resolve = async (values: Record<string, unknown>) => {
  const result = await formResolver(Schema, t)(values, undefined, {
    fields: {},
    shouldUseNativeValidation: false,
  } as ResolverOptions<Record<string, unknown>>)
  const errors = result.errors as FieldErrors
  return Object.fromEntries(Object.entries(errors).map(([key, error]) => [key, error?.message]))
}
const valid = { code: 'A-1', reason: 'Bán căn', floor: '12', occupancy: 'vacant' }

describe('formResolver shows the sentence of the rule code (DOC-68 §3.7)', () => {
  test('a valid form has no error', async () => {
    expect(await resolve(valid)).toEqual({})
  })

  test('an empty or blank required field asks for a value', async () => {
    expect((await resolve({ ...valid, code: '' })).code).toBe(t('error.required'))
    expect((await resolve({ ...valid, code: '   ' })).code).toBe(t('error.required'))
  })

  test('a length names its limit', async () => {
    expect((await resolve({ ...valid, reason: 'Bán' })).reason).toBe(
      t('error.min_length', { min: 5 }),
    )
    expect((await resolve({ ...valid, code: 'A-1234567' })).code).toBe(
      t('error.max_length', { max: 8 }),
    )
  })

  test('a pattern reads as the wrong format, a union as a choice', async () => {
    expect((await resolve({ ...valid, floor: 'abc' })).floor).toBe(t('error.format'))
    expect((await resolve({ ...valid, occupancy: 'gone' })).occupancy).toBe(t('error.enum'))
  })
})
