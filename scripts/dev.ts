/**
 * `bun run dev [api web rapp sapp]` restarts the named dev servers (all when none is named): whatever still listens on
 * their ports is stopped first, so a re-run never ends up on a second port. `bun run stop [names]` only stops them.
 * Each server owns a fixed port (the scripts pin it), which is how a stale process from an earlier run is found.
 */
export {}

const apps = {
  api: 3000,
  web: 5173,
  rapp: 8081,
  sapp: 8082,
} as const
type App = keyof typeof apps

const [command, ...names] = process.argv.slice(2)
if (command !== 'start' && command !== 'stop') {
  console.error('usage: bun scripts/dev.ts start|stop [api] [web] [rapp] [sapp]')
  process.exit(64)
}
const unknown = names.filter((name) => !(name in apps))
if (unknown.length > 0) {
  console.error(`unknown app: ${unknown.join(', ')} (known: ${Object.keys(apps).join(', ')})`)
  process.exit(64)
}
const selected = (names.length > 0 ? names : Object.keys(apps)) as App[]

const listeners = (port: number) =>
  Bun.spawnSync(['lsof', '-ti', `tcp:${port}`, '-sTCP:LISTEN'], { stderr: 'ignore' })
    .stdout.toString()
    .split('\n')
    .filter(Boolean)
    .map(Number)

const stop = async (app: App) => {
  const pids = listeners(apps[app])
  if (pids.length === 0) return
  for (const pid of pids) process.kill(pid, 'SIGTERM')
  for (let i = 0; i < 20 && listeners(apps[app]).length > 0; i++) await Bun.sleep(100)
  for (const pid of listeners(apps[app])) process.kill(pid, 'SIGKILL')
  console.log(`stopped ${app} (:${apps[app]}, pid ${pids.join(', ')})`)
}

for (const app of selected) await stop(app)
if (command === 'stop') process.exit(0)

const children = selected.map((app) =>
  Bun.spawn(['bun', 'run', app], { stdout: 'inherit', stderr: 'inherit' }),
)
const shutdown = async () => {
  for (const child of children) child.kill('SIGTERM')
  for (const app of selected) await stop(app)
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
await Promise.all(children.map((child) => child.exited))
