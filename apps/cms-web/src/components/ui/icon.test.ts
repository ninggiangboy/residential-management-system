import { expect, test } from 'bun:test'
import { ICON_NAMES } from '@rms/design-tokens'
import { ICONS } from './icons-all'

test('DS-06: the web registry maps exactly the names of ICON_NAMES to a Phosphor component', () => {
  expect(Object.keys(ICONS).sort()).toEqual([...ICON_NAMES].sort())
  for (const name of ICON_NAMES) expect(ICONS[name]).toBeTruthy()
})
