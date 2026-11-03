import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/persistence/schema.ts',
  out: './migrations',
  schemaFilter: ['realtime'],
  migrations: { schema: 'drizzle_realtime', table: '__migrations' },
})
