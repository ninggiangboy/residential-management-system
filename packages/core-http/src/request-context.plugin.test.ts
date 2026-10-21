import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { requestContextPlugin } from './request-context.plugin'

const app = new Elysia().use(requestContextPlugin).get('/x', () => 'ok')
const idOf = async (headers: Record<string, string> = {}) =>
  (await app.handle(new Request('http://localhost/x', { headers }))).headers.get('x-request-id')

describe('X-Request-Id (DOC-50 §5.1)', () => {
  test('a valid id from the caller is kept', async () => {
    expect(await idOf({ 'x-request-id': 'abc.DEF_123-x' })).toBe('abc.DEF_123-x')
  })

  test('a missing id is replaced by a UUIDv7', async () => {
    expect(await idOf()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  test('an id that is too long or holds other characters is replaced', async () => {
    for (const bad of ['x'.repeat(65), 'has space', 'semi;colon', 'ü']) {
      const id = await idOf({ 'x-request-id': bad })
      expect(id).not.toBe(bad)
      expect(id).toMatch(/^[0-9a-f-]{36}$/)
    }
    expect(await idOf({ 'x-request-id': 'x'.repeat(64) })).toBe('x'.repeat(64))
  })
})
