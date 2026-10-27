import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cleanup, must, sh, unique, waitFor } from './docker'
import { repo } from './host'

/**
 * The backup path of DOC-70 §5.5 and §8.4 end to end, the combination that DOC-70 called unproven until P1-20: the SeaweedFS S3
 * gateway over TLS with a private CA and three identities, pgBackRest with `archive-async` writing to it, a full and a differential
 * backup, the metric file, the refusal of a wrong CA and of another bucket, and a point-in-time restore. It installs pgBackRest
 * from the PGDG repository inside a PostgreSQL container, so it needs the network and about two minutes: `bun run test:backup-repo`,
 * not part of `bun run check`.
 *
 * Differences from a host, all in the permissions of mounted files (the test runs on a laptop and on a runner with other uids):
 * the secret files are copied readable by everyone before they are mounted.
 */
setDefaultTimeout(300_000)

const compose = readFileSync(join(repo, 'docker/compose.local.yml'), 'utf8')
const postgresImage = compose.match(/image: (postgres:[\w.]+)/)?.[1] ?? ''
const awsImage = compose.match(/image: (amazon\/aws-cli:[\w.]+)/)?.[1] ?? ''
const seaweedImage = readFileSync(join(repo, 'docker/compose.base.yml'), 'utf8').match(
  /image: (chrislusf\/seaweedfs:[\w.]+)/,
)?.[1]

const cleanup = new Cleanup()
const network = unique('rms-bk-net')
const gateway = unique('rms-bk-s3')
const database = unique('rms-bk-pg')
const work = mkdtempSync(join(tmpdir(), 'rms-backup-'))
const secrets = join(work, 'secrets')
const tls = join(work, 'tls')
const mount = join(work, 'mount') // what the containers see: readable copies
const env = { ...process.env, RMS_SECRETS_DIR: secrets, RMS_TLS_DIR: tls }

const read = (name: string) => readFileSync(join(secrets, name), 'utf8').trim()
const aws = (key: string, secret: string, ...args: string[]) =>
  sh([
    'docker',
    'run',
    '--rm',
    '--network',
    network,
    '-v',
    `${tls}/ca.pem:/ca.pem:ro`,
    '-v',
    `${work}:/work:ro`,
    '-e',
    `AWS_ACCESS_KEY_ID=${key}`,
    '-e',
    `AWS_SECRET_ACCESS_KEY=${secret}`,
    '-e',
    'AWS_DEFAULT_REGION=auto',
    '-e',
    'AWS_CA_BUNDLE=/ca.pem',
    awsImage,
    '--endpoint-url',
    'https://seaweedfs:8333',
    ...args,
  ])
const inDb = (user: string, command: string) =>
  sh(['docker', 'exec', '-u', user, database, 'sh', '-c', command])
const psql = (sql: string) =>
  inDb('postgres', `psql -X -v ON_ERROR_STOP=1 -U postgres -d rms -Atqc "${sql}"`)
const pgbackrest = (args: string) => inDb('postgres', `pgbackrest --stanza=rms ${args}`)

function runWith(script: string, ...args: string[]) {
  const proc = Bun.spawnSync(['bash', join(repo, 'ops', script), ...args], {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return { code: proc.exitCode ?? -1, out: `${proc.stdout}${proc.stderr}`.trim() }
}

beforeAll(() => {
  if (!seaweedImage) throw new Error('docker/compose.base.yml pins no SeaweedFS image')
  for (const dir of [secrets, tls, mount, join(work, 'data')]) mkdirSync(dir, { recursive: true })
  chmodSync(join(work, 'data'), 0o777)
  // The application's secret files, as on a host (DOC-70 §9.1), then the object store's.
  const keys = Bun.spawnSync([
    'bun',
    join(repo, 'scripts/keys-generate.ts'),
    '--out',
    secrets,
    '--env',
    'staging',
    '--db-host',
    'x',
  ])
  if (keys.exitCode !== 0) throw new Error(`keys-generate --out failed: ${keys.stderr}`)
  must(runWith('seaweedfs/tls.sh', 'staging'), 'setup')
  must(runWith('seaweedfs/identities.sh', 'staging'), 'setup')

  for (const [from, to] of [
    [join(secrets, 'seaweedfs-s3-config'), 'seaweedfs-s3-config'],
    [join(secrets, 'seaweedfs-tls-key'), 'seaweedfs.key'],
    [join(tls, 'seaweedfs.pem'), 'seaweedfs.pem'],
  ] as const) {
    cpSync(from, join(mount, to))
    chmodSync(join(mount, to), 0o444)
  }
  must(sh(['docker', 'network', 'create', network]), 'setup')
  cleanup.network(network)

  // As in docker/compose.base.yml: non-root, read-only, no capabilities; the cert and the key in one directory.
  const s3 = sh([
    'docker',
    'run',
    '-d',
    '--name',
    gateway,
    '--network',
    network,
    '--network-alias',
    'seaweedfs',
    '--user',
    '10001:10001',
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '-v',
    `${join(work, 'data')}:/data`,
    '-v',
    `${mount}/seaweedfs-s3-config:/run/secrets/seaweedfs-s3-config:ro`,
    '-v',
    `${mount}/seaweedfs.key:/etc/seaweedfs/tls/seaweedfs.key:ro`,
    '-v',
    `${mount}/seaweedfs.pem:/etc/seaweedfs/tls/seaweedfs.pem:ro`,
    seaweedImage ?? '',
    'server',
    '-dir=/data',
    '-ip.bind=0.0.0.0',
    '-filer',
    '-volume.max=8',
    '-master.volumeSizeLimitMB=512',
    '-s3',
    '-s3.port=8333',
    '-s3.config=/run/secrets/seaweedfs-s3-config',
    '-s3.cert.file=/etc/seaweedfs/tls/seaweedfs.pem',
    '-s3.key.file=/etc/seaweedfs/tls/seaweedfs.key',
  ])
  must(s3, 'setup')
  cleanup.container(gateway)
  waitFor(
    () =>
      sh([
        'docker',
        'exec',
        gateway,
        'wget',
        '-q',
        '--spider',
        '--no-check-certificate',
        'https://127.0.0.1:8333/healthz',
      ]).code === 0,
    90,
    'the S3 gateway',
  )

  const admin = [read('seaweedfs-admin-access-key'), read('seaweedfs-admin-secret-key')] as const
  waitFor(
    () => aws(...admin, 's3api', 'create-bucket', '--bucket', 'rms-staging-files').code === 0,
    60,
    'the first bucket',
  )
  must(aws(...admin, 's3api', 'create-bucket', '--bucket', 'rms-staging-backup'), 'setup')

  // The database, with pgBackRest installed from the PGDG repository that the image already trusts.
  const db = sh([
    'docker',
    'run',
    '-d',
    '--name',
    database,
    '--network',
    network,
    '-e',
    'POSTGRES_PASSWORD=x',
    '-v',
    `${tls}/ca.pem:/etc/pgbackrest/seaweedfs-ca.pem:ro`,
    '-v',
    `${join(repo, 'ops/postgres')}:/sql:ro`,
    '-v',
    `${join(repo, 'ops/backup')}:/backup:ro`,
    postgresImage,
    '-c',
    'archive_mode=on',
    '-c',
    'archive_command=pgbackrest --stanza=rms archive-push %p',
    '-c',
    'wal_level=replica',
    '-c',
    'archive_timeout=60',
  ])
  must(db, 'setup')
  cleanup.container(database)
  waitFor(() => sh(['docker', 'exec', database, 'pg_isready']).code === 0, 60, 'PostgreSQL')
  const installed = inDb(
    'root',
    'apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq pgbackrest >/dev/null 2>&1; pgbackrest version',
  )
  if (!installed.out.includes('pgBackRest'))
    throw new Error(`pgBackRest is not installed: ${installed.out}`)
  must(
    inDb(
      'postgres',
      `psql -X -v ON_ERROR_STOP=1 -U postgres -v db=rms -v app_conn_limit=45 -v migrator_password=a -v app_password=b -v readonly_password=c -f /sql/0001-provision.sql`,
    ),
    'setup',
  )

  // The configuration from the template; only the data directory differs from a host's.
  const rendered = Bun.spawnSync(['bash', join(repo, 'ops/pgbackrest/render.sh'), 'staging'], {
    env: {
      ...env,
      PGBACKREST_DIR: join(work, 'pgbackrest'),
      PGBACKREST_OWNER: `${process.getuid?.()}:${process.getgid?.()}`,
      RMS_BACKUP_ENDPOINT: 'seaweedfs:8333',
    },
  })
  if (rendered.exitCode !== 0) throw new Error(`pgbackrest/render.sh failed: ${rendered.stderr}`)
  // Only the data directory and the place of the CA differ from a host's file: the container has its own paths.
  const conf = readFileSync(join(work, 'pgbackrest/pgbackrest.conf'), 'utf8')
    .replace('/var/lib/postgresql/18/main', '/var/lib/postgresql/18/docker')
    .replace(join(work, 'pgbackrest/seaweedfs-ca.pem'), '/etc/pgbackrest/seaweedfs-ca.pem')
  writeFileSync(join(work, 'pgbackrest.conf.test'), conf)
  must(
    sh([
      'docker',
      'cp',
      join(work, 'pgbackrest.conf.test'),
      `${database}:/etc/pgbackrest/pgbackrest.conf`,
    ]),
    'setup',
  )
  must(
    inDb(
      'root',
      'chown postgres:postgres /etc/pgbackrest/pgbackrest.conf && chmod 600 /etc/pgbackrest/pgbackrest.conf && install -d -o postgres -g postgres -m 0750 /var/spool/pgbackrest /tmp/textfile',
    ),
    'setup',
  )
}, 300_000)

afterAll(() => cleanup.run())

describe('the backup repository on SeaweedFS (DOC-70 §14 checks 8, 13, 18, 20)', () => {
  test('stanza-create, check, a full and a differential backup, with the repository encrypted', () => {
    expect(pgbackrest('stanza-create').out).toContain(
      'stanza-create command end: completed successfully',
    )
    expect(pgbackrest('check').out).toContain('check command end: completed successfully')
    expect(pgbackrest('--type=full backup').out).toContain(
      'backup command end: completed successfully',
    )
    psql('create table pitr(n int); insert into pitr select generate_series(1,100);')
    expect(
      inDb('postgres', 'BACKUP_TEXTFILE_DIR=/tmp/textfile bash /backup/backup.sh diff').code,
    ).toBe(0)
    const info = pgbackrest('info').out
    expect(info).toContain('status: ok')
    expect(info).toContain('cipher: aes-256-cbc')
    expect(info).toContain('diff backup')
  })

  test('backup.sh writes the metric file only after a success (DR-154)', () => {
    const prom = inDb('postgres', 'cat /tmp/textfile/backup.prom').out
    expect(prom).toMatch(
      /^# TYPE backup_last_success_timestamp gauge\nbackup_last_success_timestamp \d{10}$/,
    )
    expect(inDb('postgres', 'ls -a /tmp/textfile').out).not.toContain('.backup.')
    // a failing backup leaves the file as it was
    const before = inDb('postgres', 'cat /tmp/textfile/backup.prom').out
    const failing = inDb(
      'postgres',
      'BACKUP_TEXTFILE_DIR=/tmp/textfile bash /backup/backup.sh nope',
    )
    expect(failing.code).toBe(2)
    expect(inDb('postgres', 'cat /tmp/textfile/backup.prom').out).toBe(before)
  })

  test('the WAL is archived by the async archiver without failures', () => {
    psql('insert into pitr select generate_series(101,200);')
    psql('select pg_switch_wal();')
    waitFor(
      () =>
        psql('select archived_count > 0 and failed_count = 0 from pg_stat_archiver').out === 't',
      60,
      'the archiver',
    )
    expect(pgbackrest('info').out).toContain('wal archive min/max')
  })

  test('check fails with a CA that did not sign the certificate, and passes with the right one (check 20)', () => {
    const other = mkdtempSync(join(tmpdir(), 'rms-other-ca-'))
    sh([
      'openssl',
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-days',
      '2',
      '-subj',
      '/CN=other',
      '-keyout',
      join(other, 'k'),
      '-out',
      join(other, 'ca.pem'),
    ])
    expect(sh(['docker', 'cp', join(other, 'ca.pem'), `${database}:/tmp/other-ca.pem`]).code).toBe(
      0,
    )
    inDb('root', 'chmod 644 /tmp/other-ca.pem')
    const wrong = pgbackrest('--repo1-storage-ca-file=/tmp/other-ca.pem check')
    expect(wrong.out).toMatch(/ERROR|certificate/i)
    expect(wrong.out).not.toContain('check command end: completed successfully')
    expect(pgbackrest('check').out).toContain('completed successfully')
  })

  test('the files identity cannot read the backup bucket and the backup identity cannot read the files bucket (check 18)', () => {
    const files = [read('s3-access-key-id'), read('s3-secret-access-key')] as const
    const backup = [
      read('seaweedfs-backup-access-key'),
      read('seaweedfs-backup-secret-key'),
    ] as const
    expect(aws(...files, 's3', 'ls', 's3://rms-staging-files').code).toBe(0)
    expect(aws(...files, 's3', 'ls', 's3://rms-staging-backup').out).toContain('AccessDenied')
    expect(aws(...backup, 's3', 'ls', 's3://rms-staging-backup').code).toBe(0)
    expect(aws(...backup, 's3', 'ls', 's3://rms-staging-files').out).toContain('AccessDenied')
    expect(aws(...files, 's3api', 'create-bucket', '--bucket', 'rms-evil').out).toContain(
      'AccessDenied',
    )
  })

  test('a point-in-time restore returns the database as it was at the target (check 13)', () => {
    psql('truncate pitr; insert into pitr select generate_series(1,100);')
    Bun.sleepSync(2000)
    const target = psql("select to_char(now(), 'YYYY-MM-DD HH24:MI:SS.US+00')").out
    Bun.sleepSync(2000)
    psql('insert into pitr select generate_series(101,200);')
    psql('select pg_switch_wal();')
    waitFor(() => pgbackrest('info').out.includes('wal archive'), 30, 'the archive')
    Bun.sleepSync(5000)
    inDb('root', 'install -d -o postgres -g postgres -m 0700 /tmp/restore')
    const restored = pgbackrest(
      `--pg1-path=/tmp/restore --type=time --target='${target}' --target-action=promote restore`,
    )
    expect(restored.out).toContain('restore command end: completed successfully')
    expect(
      inDb(
        'postgres',
        "/usr/lib/postgresql/18/bin/pg_ctl -D /tmp/restore -o '-p 5433 -c archive_mode=off -c listen_addresses=' -w -l /tmp/restore.log start",
      ).code,
    ).toBe(0)
    const rows = inDb(
      'postgres',
      'psql -X -h /var/run/postgresql -p 5433 -U postgres -d rms -Atc "select count(*) from pitr"',
    )
    inDb('postgres', '/usr/lib/postgresql/18/bin/pg_ctl -D /tmp/restore stop -m fast')
    expect(rows.out).toBe('100')
  })
})
