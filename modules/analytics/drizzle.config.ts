import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/persistence/schema.ts',
  out: './migrations',
  schemaFilter: ['analytics'],
  migrations: { schema: 'drizzle_analytics', table: '__migrations' },
})
