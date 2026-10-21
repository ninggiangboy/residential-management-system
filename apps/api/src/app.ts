import { Elysia, t } from 'elysia'

/** Skeleton of the composition root; P1-04 replaces it with `buildApp(container)` (DOC-12 §5.1). */
export function buildApp() {
  return new Elysia({ prefix: '/api/v1' }).get('/health/live', () => ({ status: 'ok' as const }), {
    response: t.Object({ status: t.Literal('ok') }),
  })
}

/** The only thing clients import from this package, and only with `import type` (DOC-12 §5.4). */
export type App = ReturnType<typeof buildApp>
