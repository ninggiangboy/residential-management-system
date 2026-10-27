/**
 * A throw-away host for the tests of `ops/deploy/*.sh` (DOC-70 §6.5): the directories of `/opt/rms` in a temporary folder and a
 * `docker` that records what it was asked and answers from files, so the script runs end to end without a daemon.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const repo = resolve(import.meta.dir, '../..')

const FAKE_DOCKER = `#!/usr/bin/env bash
# Records every call. \`inspect\` answers healthy unless the container has a file \`unhealthy.<name>\` in $FAKE_STATE.
echo "$*" >> "$FAKE_STATE/calls"
env | grep '^RMS_' | sort > "$FAKE_STATE/env.$(wc -l < "$FAKE_STATE/calls" | tr -d ' ')"
case "$1" in
  pull) [ -e "$FAKE_STATE/fail.pull" ] && exit 1; exit 0 ;;
  inspect)
    name="\${@: -1}"
    [ -e "$FAKE_STATE/unhealthy.$name" ] && echo starting || echo healthy
    ;;
  compose)
    # A real \`docker compose run\` is attached to stdin. When the script itself arrives on stdin (\`bash -s\`), a command that reads it
    # eats the rest of the script: the fake does the same, so a call that is not given </dev/null shows up as a truncated deploy.
    cat > /dev/null
    case "$*" in
      *" run --rm -T migrate"*) [ -e "$FAKE_STATE/fail.migrate" ] && exit 1; echo "migrated: 0 pending applied" ;;
    esac
    ;;
esac
exit 0
`

export type Host = {
  root: string
  state: string
  env: Record<string, string>
  calls: () => string[]
  /** The tarball CI would upload: `docker/` and `ops/` of this checkout, under the name of the tag. */
  upload: (tag: string) => void
  /** A release directory that is already unpacked, with an age in seconds. */
  release: (tag: string, ageSeconds: number) => void
  run: (script: string, args: string[], extraEnv?: Record<string, string>) => Result
  /** As CI runs it: \`ssh host "bash -s -- <args>" < ops/deploy/<script>\`, so the script is the standard input of bash. */
  runStreamed: (script: string, args: string[], extraEnv?: Record<string, string>) => Result
  deployState: () => string
  fail: (what: string) => void
  unhealthy: (container: string) => void
}

export type Result = { code: number; out: string }

export function makeHost(environment: 'staging' | 'production' = 'staging'): Host {
  const root = mkdtempSync(join(tmpdir(), 'rms-host-'))
  const state = join(root, 'fake-state')
  const bin = join(root, 'bin')
  for (const dir of ['opt/env', 'opt/releases', 'opt/incoming', 'var', 'fake-state', 'bin'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(state, 'calls'), '')
  writeFileSync(
    join(root, 'opt/env/compose.env'),
    [
      'COMPOSE_PROJECT_NAME=rms',
      `RMS_ENV=${environment}`,
      `COMPOSE_PROFILES=${environment === 'production' ? 'api2,logs' : ''}`,
      'RMS_GHCR_OWNER=acme',
      'RMS_DOMAIN=example.invalid',
      '',
    ].join('\n'),
  )
  writeFileSync(join(bin, 'docker'), FAKE_DOCKER)
  chmodSync(join(bin, 'docker'), 0o755)

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: `${bin}:${process.env.PATH}`,
    RMS_ROOT: join(root, 'opt'),
    RMS_STATE: join(root, 'var/deploy-state'),
    RMS_LOCK: join(root, 'var/lock'),
    RMS_POLL_SECONDS: '0',
    FAKE_STATE: state,
  }

  return {
    root,
    state,
    env,
    calls: () => readFileSync(join(state, 'calls'), 'utf8').split('\n').filter(Boolean),
    upload(tag) {
      const tar = Bun.spawnSync(
        ['tar', '-czf', join(root, 'opt/incoming', `${tag}.tgz`), '-C', repo, 'docker', 'ops'],
        { stderr: 'pipe' },
      )
      if (tar.exitCode !== 0) throw new Error(tar.stderr.toString())
    },
    release(tag, ageSeconds) {
      const dir = join(root, 'opt/releases', tag)
      mkdirSync(join(dir, 'docker'), { recursive: true })
      const then = new Date(Date.now() - ageSeconds * 1000)
      utimesSync(dir, then, then)
    },
    run(script, args, extraEnv = {}) {
      const proc = Bun.spawnSync(['bash', join(repo, 'ops/deploy', script), ...args], {
        env: { ...env, ...extraEnv },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      return { code: proc.exitCode ?? -1, out: `${proc.stdout}${proc.stderr}`.trim() }
    },
    runStreamed(script, args, extraEnv = {}) {
      const proc = Bun.spawnSync(['bash', '-s', '--', ...args], {
        env: { ...env, ...extraEnv },
        stdin: readFileSync(join(repo, 'ops/deploy', script)),
        stdout: 'pipe',
        stderr: 'pipe',
      })
      return { code: proc.exitCode ?? -1, out: `${proc.stdout}${proc.stderr}`.trim() }
    },
    deployState: () => {
      try {
        return readFileSync(join(root, 'var/deploy-state'), 'utf8')
      } catch {
        return ''
      }
    },
    fail: (what) => writeFileSync(join(state, `fail.${what}`), ''),
    unhealthy: (container) => writeFileSync(join(state, `unhealthy.${container}`), ''),
  }
}
