import { expect, test } from 'bun:test'
import { buildingName, hoursOf, localized, telUrl } from './contact'

const contact = {
  name: { vi: 'Chung cư Sunrise A', en: 'Sunrise A Apartments' },
  hotline: '1900 1234',
  workingHours: { vi: 'Thứ 2 – Thứ 6, 8:00 – 17:00', en: null },
  email: null,
}

test('UIRQ-20: the English text is used when it exists, Vietnamese when it is null', () => {
  expect(buildingName(contact, 'en')).toBe('Sunrise A Apartments')
  expect(buildingName(contact, 'vi')).toBe('Chung cư Sunrise A')
  expect(hoursOf(contact, 'en')).toBe('Thứ 2 – Thứ 6, 8:00 – 17:00')
  expect(hoursOf({ ...contact, workingHours: null }, 'vi')).toBeNull()
  expect(localized({ vi: 'a', en: null }, 'en')).toBe('a')
})

test('UIRA-10: a hotline written for people becomes a tel: link without spaces', () => {
  expect(telUrl('1900 1234')).toBe('tel:19001234')
})
