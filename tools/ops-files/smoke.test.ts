import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { repo } from './host'

/**
 * `ops/deploy/smoke.sh` against a stand-in for the staging hosts (DOC-70 §6.5, DOC-71 §7.3): a Bun server that answers by
 * `Host`, with one knob per check. What it cannot show is Cloudflare in front: that is §14 check 5, 6 and 21 on the real host.
 */
type Knobs = {
  ready: unknown
  liveStatus: number
  configCache: string | null
  configBody: unknown
  adminCsp: boolean
  loginStatus: number
}
const good = (): Knobs => ({
  ready: { status: 'ok', maintenance: false },
  liveStatus: 404,
  configCache: 'public, max-age=60',
  configBody: { apps: { resident: { minVersion: '1.0.0' }, staff: { minVersion: '1.0.0' } } },
  adminCsp: true,
  loginStatus: 200,
})

let knobs = good()
const seen: string[] = []
let server: ReturnType<typeof Bun.serve>

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      const host = request.headers.get('host') ?? ''
      seen.push(`${request.method} ${host}${url.pathname}`)
      if (host.startsWith('admin-staging.'))
        return new Response('<html></html>', {
          headers:
            knobs.adminCsp && request.headers.get('cf-access-client-id')
              ? { 'content-security-policy': "default-src 'self'" }
              : {},
        })
      switch (url.pathname) {
        case '/api/v1/health/ready':
          return Response.json(knobs.ready)
        case '/api/v1/health/live':
          return new Response('{}', { status: knobs.liveStatus })
        case '/api/v1/public/config':
          return Response.json(knobs.configBody, {
            headers: knobs.configCache ? { 'cache-control': knobs.configCache } : {},
          })
        case '/api/v1/auth/staff/login':
          return knobs.loginStatus === 200
            ? Response.json({ accessToken: 'a', refreshToken: 'r' })
            : new Response('{}', { status: knobs.loginStatus })
        case '/api/v1/auth/logout':
          return new Response(null, { status: 204 })
      }
      return new Response('{}', { status: 404 })
    },
  })
})
afterAll(() => server.stop(true))

async function smoke(target: 'staging' | 'production' = 'staging') {
  const proc = Bun.spawn(['bash', join(repo, 'ops/deploy/smoke.sh'), target], {
    env: {
      ...process.env,
      SMOKE_SCHEME: 'http',
      SMOKE_RETRY_SECONDS: '0',
      DOMAIN: `localhost:${server.port}`,
      CF_ACCESS_CLIENT_ID: 'id',
      CF_ACCESS_CLIENT_SECRET: 'secret',
      STAGING_DEMO_PASSWORD: 'p"ass',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { code: await proc.exited, out: `${out}${err}`.trim() }
}

describe('smoke.sh', () => {
  test('passes when every check of DOC-71 §7.3 holds, and signs in and out on staging', async () => {
    knobs = good()
    seen.length = 0
    const result = await smoke()
    expect(result.code).toBe(0)
    expect(result.out.split('\n').at(-1)).toBe('smoke passed (staging)')
    expect(seen).toContain(`POST api-staging.localhost:${server.port}/api/v1/auth/staff/login`)
    expect(seen).toContain(`POST api-staging.localhost:${server.port}/api/v1/auth/logout`)
  })

  test('each failing check is named', async () => {
    const cases: [string, Partial<Knobs>][] = [
      ['ready', { ready: { status: 'ok', maintenance: true } }],
      ['config cache header', { configCache: 'no-store' }],
      ['config body', { configBody: { apps: {} } }],
      ['ops route is public', { liveStatus: 200 }],
      ['admin CSP', { adminCsp: false }],
      ['staff login', { loginStatus: 401 }],
    ]
    for (const [name, change] of cases) {
      knobs = { ...good(), ...change }
      const result = await smoke()
      expect(result.code).toBe(1)
      expect(result.out).toContain(`smoke FAILED: ${name}`)
    }
  })

  test('production never signs in', async () => {
    knobs = good()
    seen.length = 0
    const proc = Bun.spawn(['bash', join(repo, 'ops/deploy/smoke.sh'), 'production'], {
      env: {
        ...process.env,
        SMOKE_SCHEME: 'http',
        DOMAIN: `localhost:${server.port}`,
        CF_ACCESS_CLIENT_ID: 'i',
        CF_ACCESS_CLIENT_SECRET: 's',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    // `api.localhost` has no knob for the admin host, so only the public checks before it are asserted.
    await proc.exited
    expect(seen.some((line) => line.includes('/auth/staff/login'))).toBe(false)
  })
})
