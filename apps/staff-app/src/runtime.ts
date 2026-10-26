// A type-only import: Metro must not bundle server code (DOC-12 §5.4, DR-04).
import type { App } from '@app/api'
import { treaty } from '@elysiajs/eden'
import { createDeviceRuntime } from '@rms/mobile-core'

/** Built once at start: the stores, the gates and the one authenticated fetcher (DOC-55 §4, §5). */
export const { runtime, env } = createDeviceRuntime('staff')

/** Eden Treaty is created once, with the one fetcher; a screen never builds a URL string (DOC-55 §4.1). */
export const api = treaty<App>(runtime.origin, { fetcher: runtime.authenticatedFetch }).api.v1
