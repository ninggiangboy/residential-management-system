import { createLogger } from '@core/telemetry'
import { buildApp, buildOpsApp } from '../../src/app'
import { loadAppConfig } from '../../src/bootstrap/config'
import { type ContainerOverrides, createContainer } from '../../src/bootstrap/container'

/** `.env.local` made by `bun run keys:generate`, with the database of this test file in place of `rms`. */
function testEnv(overrides: Record<string, string | undefined> = {}) {
  return { ...process.env, APP_ENV: 'test', LOG_LEVEL: 'silent', ...overrides } as Record<
    string,
    string | undefined
  >
}

export function containerFor(
  databaseUrl: string,
  overrides: ContainerOverrides = {},
  env: Record<string, string> = {},
) {
  const config = loadAppConfig(testEnv({ DATABASE_URL: databaseUrl, ...env }))
  const container = createContainer(config, createLogger('silent'), overrides)
  return { container, app: buildApp(container), ops: buildOpsApp(container) }
}

/** A port nothing listens on, found by asking the kernel. */
export function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = server.port as number
  void server.stop(true)
  return port
}

/** `main.ts` as a child process: what Docker runs. */
export function startMain(env: Record<string, string | undefined>) {
  const proc = Bun.spawn(['bun', 'src/main.ts'], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: testEnv(env) as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    proc,
    output: () => new Response(proc.stdout).text(),
    async readyStatus(opsPort: number): Promise<number | undefined> {
      try {
        return (await fetch(`http://127.0.0.1:${opsPort}/health/ready`)).status
      } catch {
        return undefined
      }
    },
  }
}
