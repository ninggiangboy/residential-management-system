import { expect, test } from 'bun:test'
import { LANGUAGES } from './index'

test('the product ships Vietnamese and English', () => {
  expect(LANGUAGES).toEqual(['vi', 'en'])
})
