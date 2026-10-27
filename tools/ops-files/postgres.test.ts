import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cleanup, must, sh, unique, waitFor } from './docker'
import { repo } from './host'

/**
 * The PostgreSQL files of DOC-70 §8 on a real PostgreSQL 18.6: `rms.conf`, `rms-staging.conf`, `pg_hba.conf`, `pg_ident.conf`
 * and `0001-provision.sql`, on a Docker network where the server has the address that stands for the bridge gateway. A file with
 * a name or value the server refuses stops it at start, so a running server is the first assertion.
 */
setDefaultTimeout(120_000)

const image = readFileSync(join(repo, 'docker/compose.local.yml'), 'utf8').match(
  /image: (postgres:[\w.]+)/,
)?.[1]
const cleanup = new Cleanup()
const network = unique('rms-pg-net')
const server = unique('rms-pg')
const passwords = { migrator: 'm1gr4t0r', app: '4pp', readonly: 'r34d0nly' }
let serverIp = ''
let clientIp = ''

const psql = (args: string, env = '') =>
  sh([
    'docker',
    'exec',
    '-u',
    'postgres',
    ...(env ? ['-e', env] : []),
    server,
    'sh',
    '-c',
    `psql -X -v ON_ERROR_STOP=1 ${args}`,
  ])

/** A client on the same network, as `api` is, to connect over TCP with a password. */
const client = (user: string, password: string, database = 'rms', host = serverIp) =>
  sh([
    'docker',
    'run',
    '--rm',
    '--network',
    network,
    '--ip',
    clientIp,
    '-e',
    `PGPASSWORD=${password}`,
    image ?? '',
    'psql',
    '-X',
    '-h',
    host,
    '-U',
    user,
    '-d',
    database,
    '-Atc',
    'select current_user',
  ])

beforeAll(() => {
  if (!image) throw new Error('docker/compose.local.yml pins no postgres image')
  must(sh(['docker', 'network', 'create', network]), 'setup')
  cleanup.network(network)
  const net = sh([
    'docker',
    'network',
    'inspect',
    '-f',
    '{{(index .IPAM.Config 0).Subnet}} {{(index .IPAM.Config 0).Gateway}}',
    network,
  ]).out
  const [subnet, gateway] = net.split(' ') as [string, string]
  const prefix = gateway.split('.').slice(0, 3).join('.')
  serverIp = `${prefix}.2`
  clientIp = `${prefix}.3`

  // The files of the repository with the bridge's address and subnet of this network in place of 172.30.0.x.
  const dir = mkdtempSync(join(tmpdir(), 'rms-pg-cfg-'))
  const adapt = (name: string) =>
    readFileSync(join(repo, 'ops/postgres', name), 'utf8')
      .replaceAll('172.30.0.0/24', subnet)
      .replaceAll('172.30.0.1', serverIp)
  for (const name of ['rms.conf', 'pg_hba.conf', 'pg_ident.conf'])
    writeFileSync(join(dir, name), adapt(name))
  writeFileSync(join(dir, 'rms-memory.conf'), adapt('rms-staging.conf'))
  writeFileSync(
    join(dir, 'postgresql.conf'),
    [
      "include '/cfg/rms.conf'",
      "include '/cfg/rms-memory.conf'",
      "hba_file = '/cfg/pg_hba.conf'",
      "ident_file = '/cfg/pg_ident.conf'",
      '',
    ].join('\n'),
  )
  chmodSync(dir, 0o755)
  for (const name of [
    'rms.conf',
    'rms-memory.conf',
    'pg_hba.conf',
    'pg_ident.conf',
    'postgresql.conf',
  ])
    chmodSync(join(dir, name), 0o644)

  const run = sh([
    'docker',
    'run',
    '-d',
    '--name',
    server,
    '--network',
    network,
    '--ip',
    serverIp,
    '-e',
    'POSTGRES_PASSWORD=super',
    '-v',
    `${dir}:/cfg:ro`,
    '-v',
    `${join(repo, 'ops/postgres')}:/sql:ro`,
    image,
    '-c',
    'config_file=/cfg/postgresql.conf',
  ])
  must(run, 'setup')
  cleanup.container(server)
  waitFor(
    () => sh(['docker', 'exec', server, 'pg_isready', '-h', serverIp]).code === 0,
    60,
    'PostgreSQL to accept connections',
  )

  const provision = psql(
    `-U postgres -v db=rms -v app_conn_limit=45 -v migrator_password=${passwords.migrator} -v app_password=${passwords.app} -v readonly_password=${passwords.readonly} -f /sql/0001-provision.sql`,
  )
  must(provision, 'setup')
  if (/ERROR|FATAL/.test(provision.out)) throw new Error(provision.out)
}, 120_000)

afterAll(() => cleanup.run())

describe('PostgreSQL configuration of a host (DOC-70 §8.3)', () => {
  test('the files are accepted by PostgreSQL 18 and their values are in force', () => {
    const settings = Object.fromEntries(
      psql(
        `-U postgres -Atc "select name || '=' || setting from pg_settings where name in ('listen_addresses','password_encryption','shared_buffers','effective_cache_size','max_connections','wal_level','archive_mode','archive_command','archive_timeout','checkpoint_timeout','max_wal_size','log_min_duration_statement','log_lock_waits','TimeZone','log_timezone')"`,
      )
        .out.split('\n')
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    )
    expect(settings).toMatchObject({
      listen_addresses: `localhost,${serverIp}`,
      password_encryption: 'scram-sha-256',
      shared_buffers: String((512 * 1024) / 8), // 8 kB pages
      effective_cache_size: String((1024 * 1024) / 8),
      max_connections: '60',
      wal_level: 'replica',
      archive_mode: 'on',
      archive_command: 'pgbackrest --stanza=rms archive-push %p',
      archive_timeout: '60',
      checkpoint_timeout: '900',
      max_wal_size: '2048',
      log_min_duration_statement: '500',
      log_lock_waits: 'on',
      TimeZone: 'UTC',
      log_timezone: 'UTC',
    })
  })

  test('pg_hba.conf has no error and rejects what it should', () => {
    expect(
      psql(`-U postgres -Atc "select count(*) from pg_hba_file_rules where error is not null"`).out,
    ).toBe('0')
    expect(psql(`-U postgres -Atc "select count(*) from pg_hba_file_rules"`).out).toBe('6')
  })

  test('the application roles connect over the bridge with their password, and only to their database', () => {
    expect(client('rms_app', passwords.app).out).toBe('rms_app')
    expect(client('rms_migrator', passwords.migrator).out).toBe('rms_migrator')
    expect(client('rms_readonly', passwords.readonly).out).toBe('rms_readonly')
    expect(client('rms_app', 'wrong').out).toContain('password authentication failed')
    expect(client('rms_app', passwords.app, 'postgres').out).toContain(
      'pg_hba.conf rejects connection',
    )
    expect(client('postgres', 'super').out).toContain('pg_hba.conf rejects connection') // the superuser is local only
  })

  test('a TCP connection that is not from the bridge is refused, loopback included', () => {
    const viaLoopback = sh([
      'docker',
      'exec',
      '-e',
      `PGPASSWORD=${passwords.app}`,
      server,
      'psql',
      '-X',
      '-h',
      '127.0.0.1',
      '-U',
      'rms_app',
      '-d',
      'rms',
      '-Atc',
      'select 1',
    ])
    expect(viaLoopback.out).toContain('pg_hba.conf rejects connection')
  })

  test('rms_backup connects over the socket as the OS user postgres, without a password (map backup)', () => {
    const ok = sh([
      'docker',
      'exec',
      '-u',
      'postgres',
      server,
      'psql',
      '-X',
      '-U',
      'rms_backup',
      '-d',
      'rms',
      '-Atc',
      'select current_user',
    ])
    expect(ok.out).toBe('rms_backup')
    const other = sh([
      'docker',
      'exec',
      '-u',
      'nobody',
      server,
      'psql',
      '-X',
      '-h',
      '/var/run/postgresql',
      '-U',
      'rms_backup',
      '-d',
      'rms',
      '-Atc',
      'select 1',
    ])
    expect(other.out).toContain('Peer authentication failed')
    const asBackup = psql(
      `-U postgres -d rms -Atc "set role rms_backup; select pg_switch_wal() is not null"`,
    )
    expect(asBackup.out.split('\n').at(-1)).toBe('t')
  })

  test('rms_readonly is a member of pg_monitor, as the exporter needs (DR-113)', () => {
    expect(
      psql(`-U postgres -Atc "select pg_has_role('rms_readonly', 'pg_monitor', 'member')"`).out,
    ).toBe('t')
  })
})

describe('postgres_exporter as the compose file starts it (DOC-70 §6.1, DR-113)', () => {
  type Service = { image: string; entrypoint: string[] }
  const compose = Bun.YAML.parse(readFileSync(join(repo, 'docker/compose.base.yml'), 'utf8')) as {
    services: Record<string, Service>
  }
  const service = compose.services['postgres-exporter'] as Service

  test('reads the URL from the secret file, connects as rms_readonly and reports the archiver and the database', () => {
    const exporter = unique('rms-pg-exp')
    const dir = mkdtempSync(join(tmpdir(), 'rms-pg-exp-'))
    writeFileSync(
      join(dir, 'db-readonly-url'),
      `postgres://rms_readonly:${passwords.readonly}@${serverIp}:5432/rms`,
    )
    chmodSync(dir, 0o755)
    chmodSync(join(dir, 'db-readonly-url'), 0o644)
    cleanup.container(exporter)
    // The entrypoint of the compose file, with its `$$` (Compose's escape of `$`) as the shell sees it.
    const [shell, flag, script] = service.entrypoint.map((part) => part.replaceAll('$$', '$')) as [
      string,
      string,
      string,
    ]
    const run = sh([
      'docker',
      'run',
      '-d',
      '--name',
      exporter,
      '--network',
      network,
      '-v',
      `${dir}/db-readonly-url:/run/secrets/db-readonly-url:ro`,
      '--entrypoint',
      shell,
      service.image,
      flag,
      script,
    ])
    expect(run.code).toBe(0)
    const metrics = () =>
      sh(['docker', 'exec', exporter, 'wget', '-q', '-O-', 'http://127.0.0.1:9187/metrics']).out
    waitFor(() => metrics().includes('pg_up'), 30, 'the exporter')
    expect(metrics()).toMatch(/^pg_up 1$/m)
    expect(metrics()).toContain('pg_stat_archiver_failed_count')
    expect(metrics()).toContain('pg_stat_database_numbackends')
  })
})
