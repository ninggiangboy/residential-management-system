import { resolve } from 'node:path'
import { cloneTemplate } from '@rms/test-support'
import { seed } from './support/seed'

/**
 * The end-to-end run (DOC-88, P1-16): a cloned and seeded database, the real API on port 3100, Vite on 5173 and Playwright in this
 * order, torn down in reverse. `bun --env-file=../../.env.local e2e/run.ts [playwright args]` from `apps/cms-web`. The stack
 * (PostgreSQL, the object store, Mailpit) must be up: `bun run infra:up`.
 */
const API_PORT = 3100
// 5173: the CORS rule of the local bucket allows this origin only (docker/compose.local.yml), and the browser `PUT` of an upload needs it.
const WEB_PORT = 5173
const root = resolve(import.meta.dir, '../../..')
const web = resolve(import.meta.dir, '..')
const apiUrl = `http://localhost:${API_PORT}/api/v1`
const mailUi = `http://localhost:${process.env.RMS_MAIL_UI_PORT ?? 8025}`

async function waitFor(url: string, label: string, ms = 60_000): Promise<void> {
  const until = Date.now() + ms
  for (;;) {
    try {
      if ((await fetch(url)).status < 500) return
    } catch {
      // not up yet
    }
    if (Date.now() > until)
      throw new Error(`${label} did not answer at ${url} within ${ms / 1000} s`)
    await Bun.sleep(300)
  }
}

// A run starts with an empty mailbox: the seeded addresses are the same every time.
await fetch(`${mailUi}/api/v1/messages`, { method: 'DELETE' }).catch(() => undefined)

const db = await cloneTemplate('empty')
const children: { kill(): void }[] = []
let code = 1
try {
  await seed(db)
  const api = Bun.spawn(['bun', 'src/main.ts'], {
    cwd: resolve(root, 'apps/api'),
    env: {
      ...process.env,
      APP_ENV: 'test',
      LOG_LEVEL: 'warn',
      DATABASE_URL: db.url,
      PORT: String(API_PORT),
      OPS_PORT: String(API_PORT + 1),
      CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
      ADMIN_BASE_URL: `http://localhost:${WEB_PORT}`,
      MAIL_DRIVER: 'smtp',
      SMTP_HOST: 'localhost',
      SMTP_PORT: process.env.RMS_MAIL_PORT ?? '1025',
      SMTP_USER: 'rms',
      MAIL_FROM: 'no-reply@sunrise.example',
    },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  children.push(api)
  const vite = Bun.spawn(['bunx', 'vite', '--port', String(WEB_PORT), '--strictPort'], {
    cwd: web,
    env: { ...process.env, VITE_API_BASE_URL: apiUrl, VITE_APP_ENV: 'e2e' },
    stdout: 'ignore',
    stderr: 'inherit',
  })
  children.push(vite)
  await Promise.all([
    waitFor(`${apiUrl}/health/ready`, 'the API'),
    waitFor(`http://localhost:${WEB_PORT}/`, 'Vite'),
  ])
  const run = Bun.spawn(['bunx', 'playwright', 'test', ...process.argv.slice(2)], {
    cwd: web,
    env: {
      ...process.env,
      E2E_BASE_URL: `http://localhost:${WEB_PORT}`,
      E2E_API_URL: apiUrl,
      E2E_MAIL_URL: mailUi,
    },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  code = await run.exited
} finally {
  for (const child of children.reverse()) child.kill()
  await db.drop()
}
process.exit(code)
