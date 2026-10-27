import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeHost } from './host'

/**
 * `ops/deploy/deploy.sh` against a host in a temporary folder and a `docker` that only records (DOC-70 §6.5, DOC-71 §7.2).
 * What this proves is the order, the stop at the first failing step, the state file and the pruning; that Docker then does the
 * right thing on a real host is the check of DOC-70 §14 (#10, #11) on staging.
 */
const A = 'sha-aaaaaaa'
const B = 'sha-bbbbbbb'

const composeCalls = (calls: string[], verb: string) =>
  calls.filter((call) => call.startsWith('compose') && call.includes(` ${verb} `))

describe('deploy.sh', () => {
  test('a first deploy runs the six steps in order and records the tag', () => {
    const host = makeHost()
    host.upload(A)
    const result = host.run('deploy.sh', [A])
    expect(result.code).toBe(0)
    expect(result.out.split('\n').filter((line) => line.startsWith('step '))).toEqual([
      'step 1/6 unpack',
      'step 2/6 pull',
      'step 3/6 migrate',
      'step 4/6 infrastructure',
      'step 5/6 rolling',
      'step 6/6 record',
    ])
    expect(result.out).toMatch(/^deploy ok sha-aaaaaaa in \d+ s$/m)
    expect(host.deployState()).toBe(`current=${A}\nprevious=none\n`)
    expect(readFileSync(join(host.root, 'opt/current/ops/caddy/Caddyfile'), 'utf8')).toContain(
      'auto_https off',
    )
  })

  test('the image is pulled from the owner of compose.env, then the migration runs before any container is recreated', () => {
    const host = makeHost()
    host.upload(A)
    host.run('deploy.sh', [A])
    const calls = host.calls()
    expect(calls[0]).toBe(`pull ghcr.io/acme/rms-api:${A}`)
    const order = (needle: string) => calls.findIndex((call) => call.includes(needle))
    expect(order('run --rm -T migrate')).toBeGreaterThan(order('pull --quiet'))
    expect(order('up -d --no-deps caddy')).toBeGreaterThan(order('run --rm -T migrate'))
    expect(order('--force-recreate worker')).toBeGreaterThan(order('up -d --no-deps caddy'))
    expect(order('--force-recreate api-1')).toBeGreaterThan(order('--force-recreate worker'))
  })

  test('the worker is recreated first, then api-1 (staging) or api-1 and api-2 (production), and production starts the logs (DR-272)', () => {
    const staging = makeHost('staging')
    staging.upload(A)
    staging.run('deploy.sh', [A])
    const recreated = (calls: string[]) =>
      composeCalls(calls, 'up').flatMap((call) => call.match(/--force-recreate (\S+)/)?.[1] ?? [])
    expect(recreated(staging.calls())).toEqual(['worker', 'api-1'])
    expect(staging.calls().some((call) => call.includes('loki alloy'))).toBe(false)

    const production = makeHost('production')
    production.upload(A)
    expect(production.run('deploy.sh', [A]).code).toBe(0)
    expect(recreated(production.calls())).toEqual(['worker', 'api-1', 'api-2'])
    expect(production.calls().some((call) => call.includes('loki alloy'))).toBe(true)
  })

  test('a failed migration stops at step 3: nothing is recreated and the state is unchanged', () => {
    const host = makeHost()
    host.upload(A)
    host.run('deploy.sh', [A])
    host.upload(B)
    host.fail('migrate')
    const before = host.calls().length
    const result = host.run('deploy.sh', [B])
    expect(result.code).toBe(1)
    expect(result.out.split('\n').at(-1)).toBe('deploy failed at step 3')
    expect(
      host
        .calls()
        .slice(before)
        .some((call) => call.includes('--force-recreate')),
    ).toBe(false)
    expect(host.deployState()).toBe(`current=${A}\nprevious=none\n`)
  })

  test('a worker that does not become healthy stops at step 5 before any api is recreated', () => {
    const host = makeHost()
    host.upload(A)
    host.unhealthy('rms-worker-1')
    const result = host.run('deploy.sh', [A], { RMS_HEALTH_SECONDS: '1' })
    expect(result.code).toBe(1)
    expect(result.out).toContain('worker not healthy')
    expect(result.out.split('\n').at(-1)).toBe('deploy failed at step 5')
    expect(host.calls().some((call) => call.includes('--force-recreate api-1'))).toBe(false)
    expect(host.deployState()).toBe('')
  })

  test('a failed pull stops at step 2 and a missing upload at step 1', () => {
    const pull = makeHost()
    pull.upload(A)
    pull.fail('pull')
    expect(pull.run('deploy.sh', [A]).out.split('\n').at(-1)).toBe('deploy failed at step 2')

    const missing = makeHost()
    const result = missing.run('deploy.sh', [A])
    expect(result.code).toBe(1)
    expect(result.out).toContain('deploy failed at step 1')
    expect(existsSync(join(missing.root, 'opt/releases', A))).toBe(false)
  })

  test('--rollback redeploys the previous tag from its directory and swaps the state', () => {
    const host = makeHost()
    host.upload(A)
    host.run('deploy.sh', [A])
    host.upload(B)
    host.run('deploy.sh', [B])
    expect(host.deployState()).toBe(`current=${B}\nprevious=${A}\n`)

    const result = host.run('deploy.sh', ['--rollback'])
    expect(result.code).toBe(0)
    expect(result.out).toContain(`deploy ok ${A}`)
    expect(host.deployState()).toBe(`current=${A}\nprevious=${B}\n`)
    expect(host.calls().at(-1)).not.toContain(B)
    expect(
      host.calls().filter((call) => call.startsWith(`pull ghcr.io/acme/rms-api:${A}`)),
    ).toHaveLength(2)
  })

  test('--rollback with no previous tag refuses', () => {
    const host = makeHost()
    host.upload(A)
    host.run('deploy.sh', [A])
    expect(host.run('deploy.sh', ['--rollback'])).toEqual({ code: 1, out: 'no previous tag' })
  })

  test('only a release tag is accepted', () => {
    const host = makeHost()
    for (const tag of ['latest', 'main', 'sha-123', '../x', 'v1.2'])
      expect(host.run('deploy.sh', [tag]).code).toBe(2)
    expect(host.run('deploy.sh', []).code).toBe(2)
  })

  test('a deploy keeps the five newest releases and never the running one or the previous', () => {
    const host = makeHost()
    host.upload(A)
    host.run('deploy.sh', [A])
    // Seven older directories; the running one (A) is the oldest of all but must stay.
    host.release('sha-1111111', 700)
    host.release('sha-2222222', 600)
    host.release('sha-3333333', 500)
    host.release('sha-4444444', 400)
    host.release('sha-5555555', 300)
    host.release('sha-6666666', 200)
    host.release(A, 1000)
    host.upload(B)
    host.run('deploy.sh', [B])
    const kept = readdirSync(join(host.root, 'opt/releases')).sort()
    expect(kept).toContain(A)
    expect(kept).toContain(B)
    expect(kept).not.toContain('sha-1111111')
    expect(kept).not.toContain('sha-2222222')
    expect(kept).toHaveLength(5 + 1) // the five newest plus the previous tag that is older than all of them
  })

  test('a configuration hash changes only when the files of that service change', () => {
    const host = makeHost()
    host.upload(A)
    host.run('deploy.sh', [A])
    host.upload(A.replace('aaaaaaa', 'ccccccc'))
    host.run('deploy.sh', ['sha-ccccccc'])
    const hashes = (file: string, name: string) =>
      readFileSync(join(host.state, file), 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]
    const files = readdirSync(host.state).filter((name) => name.startsWith('env.'))
    const caddy = new Set(files.map((file) => hashes(file, 'RMS_CFG_CADDY')).filter(Boolean))
    expect(caddy.size).toBe(1) // the same ops/caddy twice: one hash, so Compose does not recreate it
    expect([...caddy][0]).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('deploy.sh streamed over ssh (DOC-71 §7.1)', () => {
  test('runs to the end when the script is the standard input of bash and docker reads stdin', () => {
    const host = makeHost()
    host.upload(A)
    const result = host.runStreamed('deploy.sh', [A])
    expect(result.out.split('\n').at(-1)).toMatch(/^deploy ok sha-aaaaaaa in \d+ s$/)
    expect(host.deployState()).toBe(`current=${A}\nprevious=none\n`)
  })

  test('--maintenance and --rollback also run to the end when streamed', () => {
    const host = makeHost()
    host.upload(A)
    expect(host.runStreamed('deploy.sh', [A]).code).toBe(0)
    host.upload(B) // a deploy removes the tarballs it found
    expect(host.runStreamed('deploy.sh', ['--maintenance', B]).out).toContain(
      'deploy ok sha-bbbbbbb',
    )
    expect(host.runStreamed('deploy.sh', ['--rollback']).out).toContain(`deploy ok ${A}`)
  })
})

describe('maintenance.sh', () => {
  test('runs the flag script in the migrate container with the reason', () => {
    const host = makeHost()
    host.upload(A)
    host.run('deploy.sh', [A])
    const before = host.calls().length
    expect(host.run('maintenance.sh', ['on', 'Back at 14:30']).code).toBe(0)
    const call = host.calls().slice(before).join('\n')
    expect(call).toContain('run --rm -T migrate bun scripts/maintenance.ts on Back at 14:30')
  })

  test('--maintenance wraps the migration and the restarts with the flag', () => {
    const host = makeHost()
    host.upload(A)
    const result = host.run('deploy.sh', ['--maintenance', A])
    expect(result.code).toBe(0)
    const flags = host
      .calls()
      .filter((call) => call.includes('scripts/maintenance.ts'))
      .map((call) => call.split('maintenance.ts ')[1])
    expect(flags).toEqual(['on Planned maintenance', 'off'])
  })
})
