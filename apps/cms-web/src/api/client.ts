// A type-only import: the web build must not bundle server code (DOC-12 §5.4, DR-04).
import type { App } from '@app/api'
import { treaty } from '@elysiajs/eden'
import { createAuthenticatedFetch, type Gates } from '@rms/client-core'
import { refreshSession } from '../auth/refresh'
import { tokenStore } from '../auth/token-store'
import { env } from '../env'
import { languageStore } from '../lib/i18n'

type SignedOutReason = Parameters<Gates['signedOut']>[0]
let onSignedOut: (reason: SignedOutReason) => void = () => {}

/** The session installs what happens when a refresh is refused: clear the caches and go to sign-in (DOC-55 §5.4). */
export function setSignedOutHandler(handler: (reason: SignedOutReason) => void): void {
  onSignedOut = handler
}

const gates: Gates = {
  // The terms gate is the residents' (E-16, E-17); a staff token never meets it.
  termsRequired: async () => {},
  // The web has no version: its files are hashed and a reload is current (DOC-55 §16).
  upgradeRequired: () => {},
  signedOut: (reason) => onSignedOut(reason),
  language: () => languageStore.get(),
  unitId: () => null,
}

const authenticatedFetch = createAuthenticatedFetch({
  env: { app: 'web', baseUrl: env.apiBaseUrl },
  tokens: tokenStore,
  gates,
  refresh: refreshSession,
  randomId: () => crypto.randomUUID(),
})

/** Eden Treaty is created once, with the one fetcher; a screen never builds a URL string (DOC-55 §4.1). */
export const api = treaty<App>(new URL(env.apiBaseUrl).origin, {
  fetcher: authenticatedFetch,
}).api.v1

export { authenticatedFetch }
