import { bool as coreBool, csv } from '@core/config'
import { z } from 'zod'

/** The field kinds of DOC-41 §2 rule 3. Messages never echo the value: a rejected secret must not reach a log line. */

export const bool = coreBool

/** A decimal integer in `[min, max]`; `def` is the value of the `local` profile (DOC-41 §2 rule 5). */
export const int = (def: number, { min = 0, max }: { min?: number; max?: number } = {}) => {
  const bounds = z.number().int().min(min)
  return z
    .string()
    .regex(/^-?\d+$/, 'must be a decimal integer with no separators')
    .transform(Number)
    .pipe(max === undefined ? bounds : bounds.max(max))
    .default(def)
}

export const str = (def: string) => z.string().default(def)

export const url = z.url()

/** Comma separated, items trimmed, an empty item refused (DOC-41 §2 rule 3). */
export const csvList = (def: string) =>
  z
    .string()
    .default(def)
    .superRefine((value, ctx) => {
      if (value === '') return
      if (value.split(',').some((item) => item.trim() === ''))
        ctx.addIssue({ code: 'custom', message: 'an item of the list is empty' })
    })
    .transform(csv)

export const enumOf = <const T extends readonly [string, ...string[]]>(values: T, def: T[number]) =>
  z.enum(values).default(def)

export const semver = (def: string) =>
  z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'must be a version such as 1.0.0')
    .default(def)

export const timeZone = (def: string) =>
  z
    .string()
    .default(def)
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: zone })
        return true
      } catch {
        return false
      }
    }, 'must be an IANA time zone')

/** A secret string. Never defaulted; whether it is required depends on the profile and the role (`rules.ts`). */
export const secret = z.string().min(1)
