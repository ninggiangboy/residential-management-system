import { createHash } from 'node:crypto'
import { type Clock, ConflictError, RuleViolationError, ValidationError } from '@core/kernel'

/** Whose key it is: keys are scoped by `(kind, id)`, so another account's key is unrelated (DOC-50 §8.3). */
export interface IdempotencyAccount {
  kind: 'staff' | 'resident'
  id: string
}

export interface StoredKey {
  requestHash: string
  status: 'in_progress' | 'completed'
  responseStatus: number | null
  responseBody: unknown
  createdAt: Date
}

/** `platform.idempotency_key` (DOC-17 §3) as the wrapper needs it; the adapter lives where the database does. */
export interface IdempotencyStore {
  /** Runs `fn` in one transaction, or joins the open one. */
  transaction<T>(fn: () => Promise<T>): Promise<T>
  /** `INSERT … ON CONFLICT DO NOTHING`: `true` when this call made the row. A conflict with an uncommitted row waits for it. */
  claim(account: IdempotencyAccount, key: string, requestHash: string): Promise<boolean>
  find(account: IdempotencyAccount, key: string): Promise<StoredKey | null>
  complete(
    account: IdempotencyAccount,
    key: string,
    response: { status: number; body: unknown },
  ): Promise<void>
  /** Deletes the key; with `olderThan` only an `in_progress` row created before it. `true` when a row went. */
  release(account: IdempotencyAccount, key: string, olderThan?: Date): Promise<boolean>
}

/** The parts of an Elysia context the wrapper reads. A handler's own context type is narrower or wider, never conflicting. */
export interface IdempotentContext {
  request: Request
  set: { status?: number | string; headers: Record<string, string | number | undefined> }
  params?: unknown
  body?: unknown
  route?: string
  path?: string
}

export interface IdempotentSpec<C> {
  /** The account of the request, from the guard (`staffOf(context)`). */
  account: (context: C) => IdempotencyAccount
  /**
   * `transaction` (default): the key row, the handler's writes and the stored response commit together (DOC-50 §8.3).
   * `external`: the handler reaches outside before it commits (it reads the bucket), so the key is committed `in_progress` first and
   * completed after; a duplicate in between is 409 `request_in_progress` (DOC-50 §8.3, DR-143).
   */
  mode?: 'transaction' | 'external'
}

export type Idempotent = <C extends IdempotentContext, R>(
  spec: IdempotentSpec<C>,
  handler: (context: C) => Promise<R>,
) => (context: C) => Promise<R>

const KEY = /^[A-Za-z0-9_-]{8,128}$/
/** An `in_progress` key older than this belongs to a request that died: the next try takes it over. */
export const STALE_IN_PROGRESS_MS = 300_000
const REPLAYED_HEADERS = ['location'] as const

/** Keys sorted at every level, no whitespace, numbers as written (DOC-50 §8.2). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const members = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    return `{${members.join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** `SHA-256_hex(METHOD + " " + route + "\n" + params + "\n" + X-Unit-Id + "\n" + canonical body)` (DOC-50 §8.2). */
export function requestHash(context: IdempotentContext): string {
  const params = Object.entries((context.params ?? {}) as Record<string, string>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&')
  const material = [
    `${context.request.method} ${context.route ?? context.path ?? new URL(context.request.url).pathname}`,
    params,
    context.request.headers.get('x-unit-id') ?? '',
    canonicalJson(context.body),
  ].join('\n')
  return createHash('sha256').update(material).digest('hex')
}

/** The answer of a first use that is not a committed 2xx is not stored: the transaction is rolled back with it. */
class NotStored<R> extends Error {
  constructor(readonly result: R) {
    super('response not stored')
  }
}

const statusOf = (context: IdempotentContext): number => {
  const status = Number(context.set.status ?? 200)
  return Number.isFinite(status) ? status : 200
}

const reuse = () =>
  new RuleViolationError(
    'idempotency_key_reuse',
    'The Idempotency-Key was used with another request',
    '',
    'idempotency_key_reuse',
  )

/**
 * The idempotency wrapper of DOC-50 §8 and ADR-0023 (DR-74): `idempotent(spec, handler)` is the handler of a route marked `R`. The
 * key row is inserted first; a duplicate with the same request replays the stored response (`Idempotent-Replayed: true`), a
 * duplicate with another request is 422 `idempotency_key_reuse`. Only a committed 2xx is ever stored. A route that takes no key is
 * not wrapped, and a key sent to it is ignored.
 */
export function createIdempotent(store: IdempotencyStore, clock: Clock): Idempotent {
  return <C extends IdempotentContext, R>(
    spec: IdempotentSpec<C>,
    handler: (context: C) => Promise<R>,
  ) => {
    const replay = (context: C, stored: StoredKey): R => {
      const envelope = (stored.responseBody ?? {}) as {
        headers?: Record<string, string>
        body?: unknown
      }
      context.set.status = stored.responseStatus ?? 200
      for (const [name, value] of Object.entries(envelope.headers ?? {}))
        context.set.headers[name] = value
      context.set.headers['idempotent-replayed'] = 'true'
      return (envelope.body ?? undefined) as R
    }

    /** A key row that exists: the answer it forces, or `null` when the caller may claim again (the row is gone). */
    const existing = async (
      context: C,
      account: IdempotencyAccount,
      key: string,
      hash: string,
    ): Promise<{ answer: R } | null> => {
      const stored = await store.find(account, key)
      if (!stored) return null
      if (stored.requestHash !== hash) throw reuse()
      if (stored.status === 'completed') return { answer: replay(context, stored) }
      if (clock.now().getTime() - stored.createdAt.getTime() > STALE_IN_PROGRESS_MS) {
        await store.release(account, key, new Date(clock.now().getTime() - STALE_IN_PROGRESS_MS))
        return null
      }
      throw new ConflictError('request_in_progress', 'The request is still being processed', {
        retryAfterSeconds: 1,
      })
    }

    const response = (context: C, result: R) => {
      const headers: Record<string, string> = {}
      for (const name of REPLAYED_HEADERS) {
        const value = context.set.headers[name]
        if (value !== undefined) headers[name] = String(value)
      }
      return { status: statusOf(context), body: { headers, body: result ?? null } }
    }

    const inTransaction = (
      context: C,
      account: IdempotencyAccount,
      key: string,
      hash: string,
    ): Promise<R> =>
      store
        .transaction(async () => {
          for (let attempt = 0; attempt < 3; attempt++) {
            if (await store.claim(account, key, hash)) {
              const result = await handler(context)
              const stored = response(context, result)
              if (stored.status < 200 || stored.status > 299) throw new NotStored(result)
              await store.complete(account, key, stored)
              return result
            }
            const forced = await existing(context, account, key, hash)
            if (forced) return forced.answer
          }
          throw new ConflictError('request_in_progress', 'The request is still being processed', {
            retryAfterSeconds: 1,
          })
        })
        .catch((error) => {
          if (error instanceof NotStored) return error.result as R
          throw error
        })

    const outside = async (
      context: C,
      account: IdempotencyAccount,
      key: string,
      hash: string,
    ): Promise<R> => {
      let claimed = false
      for (let attempt = 0; attempt < 3 && !claimed; attempt++) {
        claimed = await store.transaction(() => store.claim(account, key, hash))
        if (claimed) break
        const forced = await existing(context, account, key, hash)
        if (forced) return forced.answer
      }
      if (!claimed)
        throw new ConflictError('request_in_progress', 'The request is still being processed', {
          retryAfterSeconds: 1,
        })
      let result: R
      try {
        result = await handler(context)
      } catch (error) {
        await store.transaction(() => store.release(account, key))
        throw error
      }
      const stored = response(context, result)
      if (stored.status < 200 || stored.status > 299)
        await store.transaction(() => store.release(account, key))
      else await store.transaction(() => store.complete(account, key, stored))
      return result
    }

    return async (context: C) => {
      const key = context.request.headers.get('idempotency-key')
      if (key === null)
        throw new ValidationError([
          { path: 'header.Idempotency-Key', code: 'required', message: 'required' },
        ])
      if (!KEY.test(key))
        throw new ValidationError([
          {
            path: 'header.Idempotency-Key',
            code: 'format',
            message: '8 to 128 letters, digits, - or _',
          },
        ])
      const account = spec.account(context)
      const hash = requestHash(context)
      return spec.mode === 'external'
        ? outside(context, account, key, hash)
        : inTransaction(context, account, key, hash)
    }
  }
}

/** For the tests of a module that mounts no route behind a key: runs the handler as it is. */
export const noIdempotency: Idempotent = (_spec, handler) => handler
