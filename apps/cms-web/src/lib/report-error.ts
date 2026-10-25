import { type ClientErrorBody, type ClientErrorKind, createErrorReporter } from '@rms/client-core'
import type { AnyRouter } from '@tanstack/react-router'
import { tokenStore } from '../auth/token-store'
import { env } from '../env'

/**
 * The reporter and the browser hooks of DOC-55 §15. `main.tsx` loads this module with a dynamic import, so the first load of
 * `/login` does not carry it (the budget of DOC-55 §3); an error in the first milliseconds, before it is in, is not reported.
 *
 * `POST /client-errors` (E-04) goes through the plain `fetch`: no refresh, no retry and no error toast. The access token goes along
 * when there is one, so the line names the account; the server ignores an invalid one.
 */
async function send(body: ClientErrorBody): Promise<void> {
  const token = tokenStore.accessToken()
  await fetch(`${env.apiBaseUrl}/client-errors`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    keepalive: true,
  })
}

const reporter = createErrorReporter({
  app: 'web',
  platform: 'web',
  appVersion: env.appVersion,
  send,
  enabled: !env.isDev,
})

export function reportError(
  kind: ClientErrorKind,
  error: unknown,
  extra: { screen?: string; requestId?: string } = {},
): void {
  reporter.report({ kind, error, ...extra })
}

/** The template of the deepest matched route (`/units/$unitId`), never the URL: no path parameter, no query (DOC-55 §15). */
export const routeTemplate = (router: AnyRouter): string | undefined => {
  const id = router.state.matches.at(-1)?.routeId
  return id === undefined ? undefined : router.routesById[id]?.fullPath
}

const CHUNK_RELOAD_KEY = 'rms.chunk-reload'

/** A lazy chunk that no longer exists after a deploy (Vite and the browsers word it differently). */
export const isChunkLoadError = (error: unknown): boolean =>
  error instanceof Error &&
  /dynamically imported module|Importing a module script failed|Loading chunk|Failed to fetch dynamically/i.test(
    error.message,
  )

/** Reloads once per tab session; `false` when it already did, so a broken deploy cannot loop (DOC-55 §16, DR-192). */
export function reloadOnceForNewDeploy(): boolean {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY) !== null) return false
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
  } catch {
    return false
  }
  window.location.reload()
  return true
}

/** `window.onerror` is a `crash`, an unhandled rejection is an `unhandled_rejection`; a chunk gone after a deploy reloads once. */
export function installErrorReporting(router: AnyRouter): void {
  window.addEventListener('error', (event) => {
    if (event.error === undefined || event.error === null) return
    reportError('crash', event.error, { screen: routeTemplate(router) })
  })
  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason) && reloadOnceForNewDeploy()) return
    reportError('unhandled_rejection', event.reason, { screen: routeTemplate(router) })
  })
}
