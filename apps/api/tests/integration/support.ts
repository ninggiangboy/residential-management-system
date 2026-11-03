import { createLogger, type Logger } from '@core/telemetry'
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
  logger: Logger = createLogger('silent'),
) {
  const config = loadAppConfig(testEnv({ DATABASE_URL: databaseUrl, ...env }))
  const container = createContainer(config, logger, overrides)
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
    /**
     * Polls readiness until 200 or the deadline. A cold `bun src/main.ts` loads every module first; on a busy machine (the
     * finance race suites running beside it) that takes longer than a few seconds, so the wait is a deadline, not a count.
     */
    async waitReady(opsPort: number, deadlineMs = 20_000): Promise<number | undefined> {
      const until = Date.now() + deadlineMs
      let status: number | undefined
      while (status !== 200 && Date.now() < until) {
        status = await this.readyStatus(opsPort)
        if (status !== 200) await Bun.sleep(100)
      }
      return status
    },
  }
}
