import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/persistence/schema.ts',
  out: './migrations',
  schemaFilter: ['audit'],
  migrations: { schema: 'drizzle_audit', table: '__migrations' },
})
