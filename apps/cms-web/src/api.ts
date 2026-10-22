// A type-only import: the web build must not bundle server code (DOC-12 §5.4, DR-04).
import { type App, buildApp } from '@app/api'
export const serverCode = buildApp
import { treaty } from '@elysiajs/eden'

export const api = treaty<App>(import.meta.env.VITE_API_URL ?? 'http://localhost:3000')
