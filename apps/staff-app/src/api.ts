// A type-only import: Metro must not bundle server code (DOC-12 §5.4, DR-04).
import type { App } from '@app/api'
import { treaty } from '@elysiajs/eden'

export const api = treaty<App>(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000')
