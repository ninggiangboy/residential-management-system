import { expect, test } from 'bun:test'
import { validBaseUrl } from './base-url'

test('DOC-55 §3: an absolute URL that ends in /api/v1 splits into the base and the origin', () => {
  expect(validBaseUrl('http://localhost:3000/api/v1')).toEqual({
    apiBaseUrl: 'http://localhost:3000/api/v1',
    origin: 'http://localhost:3000',
  })
  expect(validBaseUrl('https://api.example.vn/api/v1/')).toEqual({
    apiBaseUrl: 'https://api.example.vn/api/v1',
    origin: 'https://api.example.vn',
  })
})

test('a missing, relative or wrong-path URL stops the app with a readable error', () => {
  for (const bad of [
    undefined,
    '',
    '/api/v1',
    'http://localhost:3000',
    'http://localhost:3000/api/v2',
    'ftp://x/api/v1',
  ])
    expect(() => validBaseUrl(bad)).toThrow(
      'API_BASE_URL must be an absolute URL that ends in /api/v1',
    )
})
