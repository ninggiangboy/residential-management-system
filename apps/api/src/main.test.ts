import { describe, expect, test } from 'bun:test'
import { localEnv } from './bootstrap/config/support'

/** Runs `main.ts` with exactly this environment and reports how it ended. */
async function boot(env: Record<string, string | undefined>) {
  const clean = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  const proc = Bun.spawn(['bun', 'src/main.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { PATH: process.env.PATH ?? '', ...clean },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return {
    code,
    stdout,
    stderr,
    lines: stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

describe('boot with an invalid environment exits 78 with one config_invalid line (DOC-41 §17)', () => {
  test('CF-03 DATABASE_URL unset', async () => {
    const { code, lines } = await boot(localEnv({ DATABASE_URL: undefined }))
    expect(code).toBe(78)
    const invalid = lines.filter((line) => line.msg === 'config_invalid')
    expect(invalid).toHaveLength(1)
    expect(invalid[0]).toMatchObject({
      level: 'error',
      problems: [{ key: 'DATABASE_URL', rule: 1 }],
    })
  })

  test('CF-04 a malformed integer and a malformed boolean, each named once in the same line', async () => {
    const { code, lines } = await boot(
      localEnv({ OUTBOX_BATCH_SIZE: 'fifty', OPENAPI_ENABLED: '1' }),
    )
    expect(code).toBe(78)
    const problems = (lines.find((line) => line.msg === 'config_invalid')?.problems ?? []) as {
      key: string
    }[]
    expect(problems.map((p) => p.key).sort()).toEqual(['OPENAPI_ENABLED', 'OUTBOX_BATCH_SIZE'])
  })

  test('CF-14 the value of a refused secret appears nowhere in stdout or stderr', async () => {
    const secret = 'z'.repeat(40)
    const { code, stdout, stderr } = await boot(localEnv({ OTP_HMAC_KEY: secret }))
    expect(code).toBe(78)
    expect(stdout + stderr).not.toContain(secret)
    expect(stdout).toContain('OTP_HMAC_KEY')
  })

  test('nothing is listening after a refused boot: the process did not start the servers', async () => {
    const { lines } = await boot(
      localEnv({ DATABASE_URL: undefined, PORT: '39871', OPS_PORT: '39872' }),
    )
    expect(lines.some((line) => line.msg === 'ops_listening')).toBe(false)
  })
})
