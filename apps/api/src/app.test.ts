import { expect, test } from 'bun:test'
import { buildApp } from './app'

test('GET /api/v1/health/live answers ok', async () => {
  const res = await buildApp().handle(new Request('http://localhost/api/v1/health/live'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ status: 'ok' })
})
