/**
 * `bun run tunnel:setup` creates the named Cloudflare Tunnel once (login, tunnel, two DNS routes, the config file).
 * `bun run tunnel` restarts the API and the web CMS for the tunnel and runs it: the CMS is then at
 * https://local-web-admin-rms.nigb.dev and the API at https://local-api-rms.nigb.dev. Local only: the tunnel is
 * public, so the demo data and the login screen are open to whoever knows the address. `Ctrl-C` stops everything.
 *
 * The browser calls the API directly (`VITE_API_BASE_URL`), so the CMS needs the API address, the API needs the CMS
 * origin in `CORS_ORIGINS` (the local origin stays), and Vite needs the host in `allowedHosts` (`vite.config.ts`).
 * Both hosts sit under `nigb.dev`, so the `SameSite=Strict` refresh cookie of the identity module still works.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const NAME = 'rms-dev'
const WEB_HOST = 'local-web-admin-rms.nigb.dev'
const API_HOST = 'local-api-rms.nigb.dev'
const WEB_PORT = 5173
const API_PORT = 3000

const dir = join(homedir(), '.cloudflared')
const config = join(dir, `${NAME}.yml`)

const [command] = process.argv.slice(2)
if (command !== 'setup' && command !== 'start') {
  console.error('usage: bun scripts/tunnel.ts setup|start')
  process.exit(64)
}
if (Bun.spawnSync(['which', 'cloudflared'], { stdout: 'ignore' }).exitCode !== 0) {
  console.error('cloudflared is not installed: brew install cloudflared')
  process.exit(69)
}

const run = (args: string[]) =>
  Bun.spawnSync(['cloudflared', ...args], { stdout: 'inherit', stderr: 'inherit' }).exitCode === 0
const tunnelId = (): string | undefined => {
  const out = Bun.spawnSync(['cloudflared', 'tunnel', 'list', '--output', 'json', '--name', NAME], {
    stderr: 'ignore',
  }).stdout.toString()
  return (JSON.parse(out || 'null') as { id: string }[] | null)?.[0]?.id
}

if (command === 'setup') {
  if (!existsSync(join(dir, 'cert.pem'))) {
    console.log('Log in and pick the zone of nigb.dev in the browser.')
    if (!run(['tunnel', 'login'])) process.exit(1)
  }
  if (!tunnelId() && !run(['tunnel', 'create', NAME])) process.exit(1)
  const id = tunnelId()
  if (!id) {
    console.error(`tunnel ${NAME} was not created`)
    process.exit(1)
  }
  for (const host of [WEB_HOST, API_HOST]) {
    if (!run(['tunnel', 'route', 'dns', '--overwrite-dns', NAME, host])) process.exit(1)
  }
  await Bun.write(
    config,
    [
      `tunnel: ${id}`,
      `credentials-file: ${join(dir, `${id}.json`)}`,
      'ingress:',
      `  - hostname: ${WEB_HOST}`,
      `    service: http://localhost:${WEB_PORT}`,
      `  - hostname: ${API_HOST}`,
      `    service: http://localhost:${API_PORT}`,
      '  - service: http_status:404',
      '',
    ].join('\n'),
  )
  console.log(`\nwrote ${config}\nstart it with: bun run tunnel`)
  process.exit(0)
}

if (!existsSync(config)) {
  console.error(`no ${config}: run bun run tunnel:setup first`)
  process.exit(78)
}

const env = {
  ...process.env,
  VITE_API_BASE_URL: `https://${API_HOST}/api/v1`,
  CORS_ORIGINS: `http://localhost:${WEB_PORT},https://${WEB_HOST}`,
  RMS_TUNNEL_WEB_HOST: WEB_HOST,
  // The tunnel is a real network already: no simulated latency on top of it (DR-305; `bun run dev` keeps `.env.local`).
  DEV_LATENCY_MS: '0',
}
const children = [
  Bun.spawn(['bun', 'scripts/dev.ts', 'start', 'api', 'web'], {
    env,
    stdout: 'inherit',
    stderr: 'inherit',
  }),
  Bun.spawn(['cloudflared', 'tunnel', '--config', config, 'run', NAME], {
    stdout: 'inherit',
    stderr: 'inherit',
  }),
]
console.log(`CMS https://${WEB_HOST}\nAPI https://${API_HOST}/api/v1`)
const shutdown = () => {
  for (const child of children) child.kill('SIGTERM')
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
await Promise.race(children.map((child) => child.exited))
shutdown()
await Promise.all(children.map((child) => child.exited))
