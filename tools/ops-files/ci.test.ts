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

describe('ci-deploy.sh --prepare and --finish (DR-273)', () => {
  /** `ssh` logs its command line and stdin size; `ssh-keygen -y` prints a public key; `$SSH_FAIL_TUNNEL` makes the Tunnel refuse. */
  const fake = (extra: Record<string, string> = {}) => {
    const s = stubs({
      ssh: [
        'echo "ssh $*" >> "$STUB_LOG"',
        'if [ -t 0 ]; then :; else n=$(wc -c | tr -d " "); echo "stdin $n" >> "$STUB_LOG"; fi',
        // the Tunnel answers with the stamp of the host only when STUB_STAMP says so; the public address always answers
        'case "$*" in *ProxyCommand=none*) exit 0 ;; esac',
        '[ -z "$SSH_FAIL_TUNNEL" ] || exit 255',
        'case "$*" in *prepared*) echo "$STUB_STAMP" ;; esac',
      ].join('\n'),
      'ssh-keygen': 'case "$*" in *-lf*) exit 0 ;; esac; echo "ssh-ed25519 AAAACI"',
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
        GITHUB_REPOSITORY_OWNER: 'Some-Owner',
        DEPLOY_SSH_KEY: 'key',
        DEPLOY_KNOWN_HOSTS: 'ssh-staging.example.invalid ssh-ed25519 AAAA',
        CF_ACCESS_CLIENT_ID: 'id',
        CF_ACCESS_CLIENT_SECRET: 'secret',
        RMS_SECRETS_PACK: Buffer.from('not really a tarball').toString('base64'),
        ...extra,
      },
    }
  }

  test('through the Tunnel it logs in as ops, uploads the payload and runs the script from a file with sudo', () => {
    const f = fake()
    const result = run('ci-deploy.sh', ['staging', '--prepare'], f.env)
    expect(result.code).toBe(0)
    const log = readFileSync(f.log, 'utf8')
    expect(log).toContain('-l ops ssh-staging.example.invalid cat > .rms-bootstrap.tgz')
    expect(log).toContain('sudo -n bash')
    expect(log).toContain('prepare staging')
    expect(log).not.toContain('bash -s') // a streamed script would be read by apt and docker
    expect(log).not.toContain('ProxyCommand=none') // the public address is not used while the Tunnel answers
  })

  test('skips the whole phase when the host holds the stamp of these inputs', () => {
    // an `ssh` that answers every `cat /var/lib/rms/prepared` with the stamp it was given
    const f = fake()
    writeFileSync(
      join(f.bin, 'ssh'),
      '#!/usr/bin/env bash\necho "ssh $*" >> "$STUB_LOG"\ncase "$*" in *prepared*) cat "$STUB_STAMP_FILE" ;; esac\n',
    )
    const probe = stubs({ sha256sum: 'cat > /dev/null; echo fixedstamp -' })
    writeFileSync(join(f.dir, 'stamp'), 'fixedstamp\n')
    const result = run('ci-deploy.sh', ['staging', '--prepare'], {
      ...f.env,
      PATH: `${probe.bin}:${f.env.PATH}`,
      STUB_STAMP_FILE: join(f.dir, 'stamp'),
    })
    expect(result.out).toContain('host prepared: the stamp matches')
    expect(readFileSync(f.log, 'utf8')).not.toContain('.rms-bootstrap.tgz')
  })

  test('a host that is not behind the Tunnel yet is reached at HOST_IP, ops first and then the provider user', () => {
    const f = fake({ SSH_FAIL_TUNNEL: '1', HOST_IP: '203.0.113.7' })
    const result = run('ci-deploy.sh', ['staging', '--prepare'], f.env)
    expect(result.code).toBe(0)
    const log = readFileSync(f.log, 'utf8')
    expect(log).toContain('-l ops 203.0.113.7 true')
    expect(log).toContain('StrictHostKeyChecking=accept-new')
    expect(log).toContain('203.0.113.7 cat > .rms-bootstrap.tgz')
  })

  test('without the Tunnel and without HOST_IP it stops with a message', () => {
    const f = fake({ SSH_FAIL_TUNNEL: '1' })
    const result = run('ci-deploy.sh', ['staging', '--prepare'], f.env)
    expect(result.code).not.toBe(0)
    expect(result.out).toContain('HOST_IP is not set')
  })

  test('--finish sends the script and says which door it came through, so the firewall closes only behind the Tunnel', () => {
    const tunnel = fake()
    run('ci-deploy.sh', ['staging', '--finish'], tunnel.env)
    expect(readFileSync(tunnel.log, 'utf8')).toContain('finish staging tunnel')
    const direct = fake({ SSH_FAIL_TUNNEL: '1', HOST_IP: '203.0.113.7' })
    run('ci-deploy.sh', ['staging', '--finish'], direct.env)
    expect(readFileSync(direct.log, 'utf8')).toContain('finish staging direct')
  })

  test('the first deploy goes to HOST_IP as deploy when the Tunnel is not up', () => {
    const f = fake({ SSH_FAIL_TUNNEL: '1', HOST_IP: '203.0.113.7' })
    expect(run('ci-deploy.sh', ['staging', 'sha-abcdef0'], f.env).code).toBe(0)
    const log = readFileSync(f.log, 'utf8')
    expect(log).toContain('-l deploy 203.0.113.7 cat > /opt/rms/incoming/sha-abcdef0.tgz')
    expect(log).toContain('-l deploy 203.0.113.7 bash -s -- sha-abcdef0')
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

describe('trusted-tree.sh (DR-274)', () => {
  const SHA = 'a'.repeat(40)
  const HEAD = 'b'.repeat(40)
  type Case = {
    tree?: string
    headTree?: string
    prs?: string
    gate?: string
    e2e?: string
    broken?: boolean
    ref?: string
  }

  // The `gh` the script calls, answering as the real one does after `--jq`: the tree of a commit, the numbers of the merged
  // pull requests of the commit, the head of a pull request, and the latest conclusion of a check on the head.
  function trusted(c: Case) {
    const s = stubs({
      gh: `
if [ -n "$BROKEN" ]; then echo "gh: HTTP 500" >&2; exit 1; fi
case "$*" in
  *"/git/commits/${SHA}"*) echo "$TREE" ;;
  *"/git/commits/${HEAD}"*) echo "$HEAD_TREE" ;;
  *"/commits/${SHA}/pulls"*) printf '%s' "$PRS" ;;
  *"/pulls/"*) echo "${HEAD}" ;;
  *"check_name=gate"*) echo "$GATE" ;;
  *"check_name=e2e-web"*) echo "$E2E" ;;
  *) exit 1 ;;
esac`,
    })
    const output = join(s.dir, 'output')
    writeFileSync(output, '')
    const proc = Bun.spawnSync(['bash', join(repo, 'ops/deploy/trusted-tree.sh')], {
      env: {
        ...process.env,
        PATH: `${s.bin}:${process.env.PATH}`,
        GITHUB_REPOSITORY: 'acme/rms',
        GITHUB_SHA: SHA,
        GITHUB_REF_NAME: c.ref ?? 'dev',
        GITHUB_OUTPUT: output,
        TREE: c.tree ?? 't1',
        HEAD_TREE: c.headTree ?? 't1',
        PRS: c.prs ?? '28\n',
        GATE: c.gate ?? 'success',
        E2E: c.e2e ?? 'success',
        BROKEN: c.broken ? '1' : '',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    return {
      code: proc.exitCode ?? -1,
      out: readFileSync(output, 'utf8').trim().split('\n'),
      said: `${proc.stderr}`.trim(),
    }
  }

  test('the tree of a merged pull request whose gate passed is tested, and e2e-web too when it ran', () => {
    expect(trusted({})).toMatchObject({ code: 0, out: ['tested=true', 'e2e=passed'] })
    expect(trusted({ e2e: 'skipped' }).out).toEqual(['tested=true', 'e2e=none'])
    expect(trusted({ e2e: 'failure' }).out).toEqual(['tested=true', 'e2e=none'])
    expect(trusted({}).said).toContain('#28')
  })

  test('a direct push (no pull request), or a pull request that is not merged into dev, is not tested', () => {
    expect(trusted({ prs: '' }).out).toEqual(['tested=false', 'e2e=none'])
  })

  test('a different tree is not tested', () => {
    const result = trusted({ headTree: 't2' })
    expect(result.out).toEqual(['tested=false', 'e2e=none'])
    expect(result.said).toContain('differs')
  })

  test('a head whose gate is not green, or has no gate, is not tested', () => {
    expect(trusted({ gate: 'failure' }).out).toEqual(['tested=false', 'e2e=none'])
    expect(trusted({ gate: 'none' }).out).toEqual(['tested=false', 'e2e=none'])
    expect(trusted({ gate: 'cancelled' }).out).toEqual(['tested=false', 'e2e=none'])
  })

  // A push to `staging` is a fast-forward of `dev` (DR-276): the commit is the one `dev` already checked, so there is no pull request
  // to look for and `gate` on the pushed commit itself is the answer.
  test('a push to staging is tested when gate passed on that very commit, and e2e-web too when it ran', () => {
    expect(trusted({ ref: 'staging', prs: '' })).toMatchObject({
      code: 0,
      out: ['tested=true', 'e2e=passed'],
    })
    expect(trusted({ ref: 'staging', prs: '', e2e: 'skipped' }).out).toEqual([
      'tested=true',
      'e2e=none',
    ])
    expect(trusted({ ref: 'staging', prs: '' }).said).toContain('already passed gate')
  })

  test('a push to staging whose commit has no green gate runs every check', () => {
    expect(trusted({ ref: 'staging', gate: 'failure' }).out).toEqual(['tested=false', 'e2e=none'])
    expect(trusted({ ref: 'staging', gate: 'none' }).out).toEqual(['tested=false', 'e2e=none'])
  })

  test('an API failure is not tested, exits 0 and leaves the workflow to run every check', () => {
    const result = trusted({ broken: true })
    expect(result.code).toBe(0)
    expect(result.out).toEqual(['tested=false', 'e2e=none'])
  })
})

describe('the workflows', () => {
  // A change of documents only skips the code jobs (DR-277), so a document that a test or a check reads must be in `code`.
  test('every document that code reads is in the `code` paths of paths-filter.yml', () => {
    const filter = readFileSync(join(repo, '.github/paths-filter.yml'), 'utf8')
    const code = filter.slice(filter.indexOf('\ncode:'), filter.indexOf('\ne2e:'))
    const listed = new Set([...code.matchAll(/^ {2}- (docs\/\S+)/gm)].map((m) => m[1]))
    const files = Bun.spawnSync(['git', 'ls-files', '*.ts', '*.cjs', '*.sh'], { cwd: repo })
      .stdout.toString()
      .split('\n')
    const read = new Set<string>()
    // This file names documents as cases of the next test; it reads none.
    for (const file of files.filter((f) => f && f !== 'tools/ops-files/ci.test.ts')) {
      for (const m of readFileSync(join(repo, file), 'utf8').matchAll(/\bdocs\/[\w./-]+\.md\b/g))
        read.add(m[0])
    }
    expect(read.size).toBeGreaterThan(0)
    expect([...read].filter((doc) => !listed.has(doc)).sort()).toEqual([])
  })

  test('the `code` paths leave out documents and Markdown and keep what code reads', () => {
    const picomatch = require('picomatch') as (
      glob: string,
      options: { dot: boolean },
    ) => (path: string) => boolean
    const filter = readFileSync(join(repo, '.github/paths-filter.yml'), 'utf8')
    const code = filter.slice(filter.indexOf('\ncode:'), filter.indexOf('\ne2e:'))
    // dorny/paths-filter compiles each pattern with picomatch and `dot: true`; one match is enough (the default quantifier).
    const globs = [...code.matchAll(/^ {2}- '?([^'\s]+)'?/gm)].map((m) =>
      picomatch(m[1] as string, { dot: true }),
    )
    const matches = (path: string) => globs.some((glob) => glob(path))
    for (const path of [
      'docs/README.md',
      'docs/09-operations/ci-cd.md',
      'README.md',
      'CLAUDE.md',
      'packages/core-db/README.md',
    ])
      expect(`${path} ${matches(path)}`).toBe(`${path} false`)
    for (const path of [
      'apps/api/src/main.ts',
      '.github/workflows/ci.yml',
      'bun.lock',
      'docs/06-design/observability.md',
    ])
      expect(`${path} ${matches(path)}`).toBe(`${path} true`)
  })

  // GitHub runs a `run` step with `bash -e {0}`: no pipefail, so `command | tee file` exits 0 when `command` fails. A deploy that
  // failed would then end the step green and the job could record a successful deployment, which `promote` reads (DOC-71 §7.4).
  test('every run step that pipes into tee sets pipefail first', () => {
    const files = ['ci.yml', 'rollback.yml', 'weekly.yml']
    for (const file of files) {
      const text = readFileSync(join(repo, '.github/workflows', file), 'utf8')
      const blocks = text.split(/\n(?=\s+- (?:name|id|uses|run|if|env):|\s+run:)/)
      for (const block of blocks) {
        if (!/\|\s*tee\b/.test(block)) continue
        expect(`${file}: ${block.slice(0, 80)}`).toBeDefined()
        expect(/set -o pipefail|shell: bash\b/.test(block)).toBe(true)
      }
    }
  })
})
