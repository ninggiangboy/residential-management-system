import { cleanTestDatabases } from './template-db'

const dropped = await cleanTestDatabases()
process.stdout.write(
  `${dropped.length === 0 ? 'no leftover test databases' : `dropped ${dropped.length}: ${dropped.join(', ')}`}\n`,
)
