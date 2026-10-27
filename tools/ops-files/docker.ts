/** Helpers for the tests that run a real container (the configuration of PostgreSQL, Caddy, SeaweedFS and pgBackRest). */

export type Run = { code: number; out: string }

export function sh(command: string[], options: { stdin?: string } = {}): Run {
  const proc = Bun.spawnSync(command, {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: options.stdin === undefined ? undefined : new TextEncoder().encode(options.stdin),
  })
  return { code: proc.exitCode ?? -1, out: `${proc.stdout}${proc.stderr}`.trim() }
}

/** A name that no other run of the tests uses, for networks and containers. */
export const unique = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`

/** Removes containers, networks and volumes when the test file ends, whatever happened. */
export class Cleanup {
  private readonly steps: string[][] = []
  container(name: string) {
    this.steps.push(['docker', 'rm', '-f', '-v', name])
  }
  network(name: string) {
    this.steps.push(['docker', 'network', 'rm', name])
  }
  volume(name: string) {
    this.steps.push(['docker', 'volume', 'rm', '-f', name])
  }
  run() {
    for (const step of this.steps.reverse()) sh(step)
  }
}

export function waitFor(check: () => boolean, seconds: number, what: string) {
  const end = Date.now() + seconds * 1000
  while (Date.now() < end) {
    if (check()) return
    Bun.sleepSync(500)
  }
  throw new Error(`timed out after ${seconds} s waiting for ${what}`)
}

/** A setup step outside a test, where `expect` is not meant to be used: a step that fails stops the file with its output. */
export function must(run: Run, what: string): Run {
  if (run.code !== 0) throw new Error(`${what} failed (${run.code}): ${run.out}`)
  return run
}
