import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/persistence/schema.ts',
  out: './migrations',
  schemaFilter: ['identity'],
  migrations: { schema: 'drizzle_identity', table: '__migrations' },
})
