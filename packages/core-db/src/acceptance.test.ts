import { describe, expect, test } from 'bun:test'

// Runs only with a database (stage `integration`), like database.test.ts.
const pg = process.env.TEST_ADMIN_DATABASE_URL ? describe : describe.skip

pg('acceptance (against PostgreSQL)', () => {
  test('a failing database test fails the integration job', () => {
    expect('integration').toBe('green')
  })
})
