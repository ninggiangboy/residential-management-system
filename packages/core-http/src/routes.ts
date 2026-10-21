import { type TObject, type TProperties, Type } from '@sinclair/typebox'
import { Elysia, type ElysiaConfig } from 'elysia'

/**
 * A route plugin of a module (DOC-12 §4.1). `normalize: false` is what makes an unknown key of a body a 400 `unknown_key`:
 * with Elysia's default the key is silently stripped and the schema's `additionalProperties: false` never reports it
 * (DOC-50 §6, AG-20). Every route plugin is created with this, never with `new Elysia(…)`.
 */
export const routePlugin = <const Prefix extends string = ''>(config: ElysiaConfig<Prefix> = {}) =>
  new Elysia({ ...config, normalize: false })

/** A request body that refuses unknown keys (DOC-50 §6). */
export const strictObject = <T extends TProperties>(properties: T): TObject<T> =>
  Type.Object(properties, { additionalProperties: false })
