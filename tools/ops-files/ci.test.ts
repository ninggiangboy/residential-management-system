import { describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repo } from './host'

/**
 * The two scripts the workflows call (DOC-71 §6.2, §7.1): `ci-deploy.sh` with a stand-in for `ssh`, and `ghcr-cleanup.sh` with a
 * stand-in for `gh`. The Tunnel, Access and GHCR themselves are what DOC-70 §14 checks 3 and 4 and the first weekly run prove.
 */
function stubs(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'rms-ci-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  return { dir, bin, log: join(dir, 'log') }
}

function run(script: string, args: string[], env: Record<string, string>) {
  const proc = Bun.spawnSync(['bash', join(repo, 'ops/deploy', script), ...args], {
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { code: proc.exitCode ?? -1, out: `${proc.stdout}${proc.stderr}`.trim() }
}

describe('ci-deploy.sh', () => {
  const fake = () => {
    const s = stubs({
      // records the command and how many bytes arrived on stdin
      ssh: `echo "ssh $*" >> "$STUB_LOG"; if [ -t 0 ]; then :; else echo "stdin $(wc -c | tr -d ' ')" >> "$STUB_LOG"; fi; echo sha-1234567`,
    })
    const home = join(s.dir, 'home')
    mkdirSync(home)
    return {
      ...s,
      env: {
        PATH: `${s.bin}:${process.env.PATH}`,
        HOME: home,
        STUB_LOG: s.log,
        DOMAIN: 'example.invalid',
        DEPLOY_SSH_KEY: '-----BEGIN KEY-----\nabc\n-----END KEY-----',
        DEPLOY_KNOWN_HOSTS: 'ssh-staging.example.invalid ssh-ed25519 AAAA',
        CF_ACCESS_CLIENT_ID: 'client-id.access',
        CF_ACCESS_CLIENT_SECRET: 'client-secret-value',
      },
    }
  }

  test('sets up ssh through the Tunnel without writing the service token into a file', () => {
    const f = fake()
    expect(run('ci-deploy.sh', ['staging', '--running-tag'], f.env).out).toBe('sha-1234567')
    const config = readFileSync(join(f.env.HOME, '.ssh/config'), 'utf8')
    expect(config).toContain('Host ssh-staging.example.invalid')
    expect(config).toContain('User deploy')
    expect(config).toContain('StrictHostKeyChecking yes')
    expect(config).toContain('ProxyCommand cloudflared access ssh --hostname %h')
    expect(config).not.toContain('client-secret-value')
    expect(config).not.toContain('client-id.access')
    expect(statSync(join(f.env.HOME, '.ssh/id_deploy')).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(f.env.HOME, '.ssh/known_hosts'), 'utf8')).toContain('ssh-ed25519 AAAA')
    expect(readFileSync(f.log, 'utf8')).toContain('ssh ssh-staging.example.invalid sed -n')
  })

  test('hands the service token to cloudflared through the environment', () => {
    const f = fake()
    const probe = stubs({
      cloudflared: 'echo "$TUNNEL_SERVICE_TOKEN_ID/$TUNNEL_SERVICE_TOKEN_SECRET" > "$STUB_LOG"',
    })
    // ssh stub that runs the ProxyCommand of the config, as ssh would
    writeFileSync(
      join(f.bin, 'ssh'),
      '#!/usr/bin/env bash\nbash -c "$(sed -n \'s/^ *ProxyCommand //p\' "$HOME/.ssh/config" | sed "s/%h/$1/")"\n',
    )
    run('ci-deploy.sh', ['staging', '--running-tag'], {
      ...f.env,
      PATH: `${probe.bin}:${f.env.PATH}`,
      STUB_LOG: probe.log,
    })
    expect(readFileSync(probe.log, 'utf8').trim()).toBe('client-id.access/client-secret-value')
  })

  test('uploads docker/ and ops/ as the tag and streams deploy.sh of this commit', () => {
    const f = fake()
    const result = run('ci-deploy.sh', ['staging', 'sha-abcdef0'], f.env)
    expect(result.code).toBe(0)
    const log = readFileSync(f.log, 'utf8')
    expect(log).toContain('ssh ssh-staging.example.invalid cat > /opt/rms/incoming/sha-abcdef0.tgz')
    expect(log).toContain('ssh ssh-staging.example.invalid bash -s -- sha-abcdef0')
    const sizes = [...log.matchAll(/stdin (\d+)/g)].map((m) => Number(m[1]))
    expect(sizes[0]).toBeGreaterThan(10_000) // the tarball
    expect(sizes[1]).toBe(statSync(join(repo, 'ops/deploy/deploy.sh')).size) // the script, byte for byte
  })

  test('a rollback uploads nothing', () => {
    const f = fake()
    expect(run('ci-deploy.sh', ['staging', '--rollback'], f.env).code).toBe(0)
    const log = readFileSync(f.log, 'utf8')
    expect(log).toContain('bash -s -- --rollback')
    expect(log).not.toContain('incoming')
  })

  test('refuses what is not a release tag or an environment, before it connects', () => {
    const f = fake()
    for (const tag of ['latest', 'main', 'sha-1', '$(id)']) {
      expect(run('ci-deploy.sh', ['staging', tag], f.env).code).toBe(2)
    }
    expect(run('ci-deploy.sh', ['qa', 'sha-abcdef0'], f.env).code).toBe(2)
    expect(() => readFileSync(f.log, 'utf8')).toThrow()
  })

  test('--tags asks the host for the running and the previous tag and drops none', () => {
    const f = fake()
    writeFileSync(
      join(f.bin, 'ssh'),
      '#!/usr/bin/env bash\necho "ssh $*" >> "$STUB_LOG"\nprintf \'sha-1234567\\nnone\\n\'\n',
    )
    const result = run('ci-deploy.sh', ['staging', '--tags'], f.env)
    expect(result.out).toBe('sha-1234567')
    expect(readFileSync(f.log, 'utf8')).toContain('current')
  })

  test('production uses its own host name', () => {
    const f = fake()
    run('ci-deploy.sh', ['production', '--running-tag'], f.env)
    expect(readFileSync(join(f.env.HOME, '.ssh/config'), 'utf8')).toContain(
      'Host ssh.example.invalid',
    )
  })
})

describe('ghcr-cleanup.sh', () => {
  // 34 versions with a `sha-` tag, one per hour; `sha-0000000` is the newest. Plus the exceptions.
  const hex = (n: number) => n.toString(16).padStart(7, '0')
  const shaVersions = Array.from({ length: 34 }, (_, i) => ({
    id: 1000 + i,
    name: `sha256:${i}`,
    created_at: new Date(Date.UTC(2026, 9, 27, 12) - i * 3_600_000).toISOString(),
    metadata: { container: { tags: [`sha-${hex(i)}`] } },
  }))
  const versions = [
    ...shaVersions,
    // old, but a release: it also has a v tag
    {
      id: 1,
      name: 'sha256:r',
      created_at: '2026-01-01T00:00:00Z',
      metadata: { container: { tags: ['sha-aaaaaaa', 'v1.0.0'] } },
    },
    {
      id: 2,
      name: 'sha256:u',
      created_at: '2026-01-01T00:00:00Z',
      metadata: { container: { tags: [] } },
    },
  ]
  const gh = (log: string, data: string) =>
    stubs({
      gh: `
echo "gh $*" >> "${log}"
case "$*" in
  "api /users/acme --jq .type") echo User ;;
  api\\ --paginate*versions*) cat "${data}" ;;
  "api -X DELETE"*) ;;
esac`,
    })

  const setup = (pages: unknown[][]) => {
    const dir = mkdtempSync(join(tmpdir(), 'rms-ghcr-'))
    const data = join(dir, 'versions.json')
    // `gh api --paginate` prints one JSON array per page
    writeFileSync(data, pages.map((page) => JSON.stringify(page)).join('\n'))
    const log = join(dir, 'log')
    const s = gh(log, data)
    return { log, env: { GH_BIN: join(s.bin, 'gh') } }
  }
  const deleted = (log: string) =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter((line) => line.includes('DELETE'))
      .map((line) => Number(line.match(/versions\/(\d+)/)?.[1]))

  test('keeps the 30 newest sha versions, every release and every untagged version, across pages', () => {
    const t = setup([versions.slice(0, 20), versions.slice(20)])
    const result = run('ghcr-cleanup.sh', ['acme'], t.env)
    expect(result.code).toBe(0)
    expect(deleted(t.log).sort()).toEqual([1030, 1031, 1032, 1033]) // the four oldest of the 34
    expect(result.out).toContain('deleted 1033 (sha-0000021)')
  })

  test('never deletes a tag that runs in an environment, even among the oldest', () => {
    const t = setup([versions])
    const result = run('ghcr-cleanup.sh', ['acme', 'sha-0000021', 'sha-0000020'], t.env)
    // 1031 (sha-…1f) is the next oldest after the protected 1033 and 1032; the protected ones do not count towards the 30
    expect(deleted(t.log)).not.toContain(1033)
    expect(deleted(t.log)).not.toContain(1032)
    expect(result.out).not.toContain('sha-0000021')
  })

  test('--dry-run deletes nothing and says what it would', () => {
    const t = setup([versions])
    const result = run('ghcr-cleanup.sh', ['acme', '--dry-run'], t.env)
    expect(result.out).toContain('would delete 1033')
    expect(deleted(t.log)).toEqual([])
  })

  test('with fewer than 30 versions there is nothing to do', () => {
    const t = setup([versions.slice(0, 10)])
    expect(run('ghcr-cleanup.sh', ['acme'], t.env).out).toBe('nothing to delete')
    expect(deleted(t.log)).toEqual([])
  })
})
