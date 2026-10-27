import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Cleanup, must, sh, unique, waitFor } from './docker'
import { repo } from './host'

/**
 * `ops/caddy/Caddyfile` on the Caddy of `docker/compose.base.yml`, started the way Compose starts it (non-root, read-only, no
 * capabilities but the port), in front of a stand-in for `api-1` (DOC-70 §7.1, §14 checks 5 and 6 as far as Caddy decides them).
 */
setDefaultTimeout(120_000)

const caddyImage =
  readFileSync(join(repo, 'docker/compose.base.yml'), 'utf8').match(/image: (caddy:[\w.]+)/)?.[1] ??
  ''
const bunImage =
  readFileSync(join(repo, 'docker/Dockerfile.api'), 'utf8').match(/FROM (oven\/bun:[\w.]+)/)?.[1] ??
  ''
const cleanup = new Cleanup()
const network = unique('rms-caddy-net')
const upstream = unique('rms-caddy-up')
const proxy = unique('rms-caddy')
let base = ''

const UPSTREAM_SERVER = `
const json = (req) => Response.json({ method: req.method, url: new URL(req.url).pathname, headers: Object.fromEntries(req.headers) })
Bun.serve({ port: 3000, async fetch(req) {
  const path = new URL(req.url).pathname
  if (path === '/api/v1/staff/events') {
    return new Response(new ReadableStream({ async start(c) {
      c.enqueue('data: first\\n\\n'); await Bun.sleep(3000); c.enqueue('data: second\\n\\n'); c.close()
    } }), { headers: { 'content-type': 'text/event-stream', server: 'bun' } })
  }
  if (req.method === 'POST') return new Response('read ' + (await req.arrayBuffer()).byteLength)
  return json(req)
} })
Bun.serve({ port: 3001, fetch: (req) => new URL(req.url).pathname === '/health/ready' ? new Response('ok') : new Response('no', { status: 404 }) })
`

beforeAll(() => {
  must(sh(['docker', 'network', 'create', network]), 'setup')
  cleanup.network(network)
  must(
    sh([
      'docker',
      'run',
      '-d',
      '--name',
      upstream,
      '--network',
      network,
      '--network-alias',
      'api-1',
      bunImage,
      'bun',
      '-e',
      UPSTREAM_SERVER,
    ]),
    'setup',
  )
  cleanup.container(upstream)
  const run = sh([
    'docker',
    'run',
    '-d',
    '--name',
    proxy,
    '--network',
    network,
    '-p',
    '127.0.0.1::80',
    '--user',
    '10001:10001',
    '--read-only',
    '--tmpfs',
    '/config',
    '--cap-drop',
    'ALL',
    '--cap-add',
    'NET_BIND_SERVICE',
    '--security-opt',
    'no-new-privileges:true',
    '-e',
    'RMS_UPSTREAMS=api-1:3000',
    '-v',
    `${join(repo, 'ops/caddy/Caddyfile')}:/etc/caddy/Caddyfile:ro`,
    caddyImage,
  ])
  must(run, 'setup')
  cleanup.container(proxy)
  const port = sh(['docker', 'port', proxy, '80/tcp']).out.split(':').at(-1)
  base = `http://127.0.0.1:${port}`
  waitFor(
    () =>
      sh(['docker', 'exec', proxy, 'wget', '-q', '--spider', 'http://127.0.0.1:8081/healthz'])
        .code === 0,
    30,
    'Caddy',
  )
  // The active health check of the upstream runs every 5 s; wait until a request is routed.
  waitFor(
    () =>
      sh(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', `${base}/api/v1/ping`]).out ===
      '200',
    30,
    'the upstream to be healthy',
  )
})
afterAll(() => cleanup.run())

describe('the Caddyfile (DOC-70 §7.1)', () => {
  test('forwards a request, with the headers of DOC-39 §5.1 and without a Server header', async () => {
    const response = await fetch(`${base}/api/v1/ping`)
    expect(response.status).toBe(200)
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('permissions-policy')).toBe(
      'camera=(), microphone=(), geolocation=()',
    )
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    )
    expect(response.headers.get('server')).toBeNull()
  })

  test('the OpenAPI page (staging only) gets no CSP, so its own scripts run (SC-16)', async () => {
    const response = await fetch(`${base}/api/v1/docs`)
    expect(response.headers.get('content-security-policy')).toBeNull()
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('passes CF-Connecting-IP to the application and adds the forwarding headers', async () => {
    const seen = (await (
      await fetch(`${base}/api/v1/ping`, { headers: { 'CF-Connecting-IP': '203.0.113.7' } })
    ).json()) as {
      headers: Record<string, string>
    }
    expect(seen.headers['cf-connecting-ip']).toBe('203.0.113.7')
    expect(seen.headers['x-forwarded-for']).toBeTruthy() // the peer is in a private range, so Caddy trusts and extends the chain
  })

  test('a body over 2 MB is refused by Caddy before the application sees it', async () => {
    const small = await fetch(`${base}/api/v1/ping`, {
      method: 'POST',
      body: new Uint8Array(1024 * 1024),
    })
    expect(await small.text()).toBe(`read ${1024 * 1024}`)
    const big = await fetch(`${base}/api/v1/ping`, {
      method: 'POST',
      body: new Uint8Array(3 * 1024 * 1024),
    })
    expect(big.status).toBe(413)
    // the 413 is Caddy's own: the upstream stays in rotation (a passive health check would count it as a failure)
    expect((await fetch(`${base}/api/v1/ping`, { keepalive: false })).status).toBe(200)
  })

  test('the event stream is not buffered: the first event arrives before the stream ends', async () => {
    // curl rather than fetch: the 413 above leaves a connection that a pooled client would reuse
    const started = Date.now()
    const proc = Bun.spawn(['curl', '-sN', '--max-time', '8', `${base}/api/v1/staff/events`], {
      stdout: 'pipe',
    })
    const reader = proc.stdout.getReader()
    const first = await reader.read()
    const elapsed = Date.now() - started
    expect(new TextDecoder().decode(first.value)).toBe('data: first\n\n')
    expect(elapsed).toBeLessThan(2000) // the upstream waits 3 s before its second event
    proc.kill()
  })

  test('with no healthy upstream Caddy answers 503, and recovers when it returns', async () => {
    expect(sh(['docker', 'stop', upstream]).code).toBe(0)
    waitFor(
      () =>
        sh(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', `${base}/api/v1/ping`]).out ===
        '503',
      30,
      'a 503',
    )
    expect(sh(['docker', 'start', upstream]).code).toBe(0)
    waitFor(
      () =>
        sh(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', `${base}/api/v1/ping`]).out ===
        '200',
      60,
      'recovery',
    )
  })

  test('a stopped upstream of two costs no request: Caddy tries the other one before its health check notices (DR-272)', async () => {
    const second = unique('rms-caddy-up2')
    const pair = unique('rms-caddy-pair')
    must(
      sh([
        'docker',
        'run',
        '-d',
        '--name',
        second,
        '--network',
        network,
        '--network-alias',
        'api-2',
        bunImage,
        'bun',
        '-e',
        UPSTREAM_SERVER,
      ]),
      'second upstream',
    )
    cleanup.container(second)
    must(
      sh([
        'docker',
        'run',
        '-d',
        '--name',
        pair,
        '--network',
        network,
        '-p',
        '127.0.0.1::80',
        '--user',
        '10001:10001',
        '--read-only',
        '--tmpfs',
        '/config',
        '--cap-drop',
        'ALL',
        '--cap-add',
        'NET_BIND_SERVICE',
        '--security-opt',
        'no-new-privileges:true',
        '-e',
        'RMS_UPSTREAMS=api-1:3000 api-2:3000',
        '-v',
        `${join(repo, 'ops/caddy/Caddyfile')}:/etc/caddy/Caddyfile:ro`,
        caddyImage,
      ]),
      'second proxy',
    )
    cleanup.container(pair)
    const url = `http://127.0.0.1:${sh(['docker', 'port', pair, '80/tcp']).out.split(':').at(-1)}/api/v1/ping`
    const status = () => sh(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', url]).out
    waitFor(() => status() === '200', 30, 'the pair to answer')
    // Both are in rotation once the first health pass is done (5 s).
    Bun.sleepSync(6000)
    // A kill, not a stop: the container is gone at once and the next health check is up to 5 s away.
    expect(sh(['docker', 'kill', second]).code).toBe(0)
    const answers = Array.from({ length: 40 }, status)
    expect(answers.filter((code) => code !== '200')).toEqual([])
  })

  test('the health port is not routed to the application and answers on its own', async () => {
    expect(
      sh(['docker', 'exec', proxy, 'wget', '-q', '-O-', 'http://127.0.0.1:8081/healthz']).out,
    ).toBe('ok')
    // port 80 never serves the health site: /healthz goes to the upstream like any path
    const response = await fetch(`${base}/healthz`)
    expect(((await response.json()) as { url: string }).url).toBe('/healthz')
  })
})
