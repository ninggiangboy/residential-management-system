/**
 * Connection strings of the test cluster (DOC-88 §6). Every value comes from `.env.local` (`bun run keys:generate`) or from
 * `TEST_*` variables, so CI points the same code at its service container.
 */

const env = (name: string) => process.env[name]

const need = (name: string): string => {
  const value = env(name)
  if (!value)
    throw new Error(
      `${name} is not set: run \`bun run keys:generate\` and start the tests with \`--env-file=.env.local\``,
    )
  return value
}

const url = (user: string, password: string, database: string) =>
  `postgres://${user}:${password}@localhost:${env('RMS_PG_PORT') ?? '5432'}/${database}`

/** A superuser URL: only it may `CREATE DATABASE` (the application roles have `NOCREATEDB`, DOC-19 §2). */
export const adminUrl = (): string =>
  env('TEST_ADMIN_DATABASE_URL') ?? url('postgres', need('RMS_POSTGRES_PASSWORD'), 'postgres')

/** The URL a test connects with: `rms_app`, the role the application uses, so a missing grant fails here and not in staging. */
export const appUrl = (): string =>
  env('TEST_APP_DATABASE_URL') ?? url('rms_app', need('RMS_APP_PASSWORD'), 'postgres')

/** `rms_migrator`: for fixtures that need DDL or the audit table, and for building the template. */
export const migratorUrl = (): string =>
  env('TEST_MIGRATOR_DATABASE_URL') ??
  url('rms_migrator', need('RMS_MIGRATOR_PASSWORD'), 'postgres')

/** The same server and credentials with another database name. */
export function withDatabase(connection: string, database: string): string {
  const parsed = new URL(connection)
  parsed.pathname = `/${database}`
  return parsed.toString()
}
