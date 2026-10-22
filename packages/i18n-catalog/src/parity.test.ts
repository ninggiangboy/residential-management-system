import { describe, expect, test } from 'bun:test'
import { CATALOGS } from './catalog'
import { compareCatalogs, messageArguments } from './icu'

const names = { base: 'en', other: 'vi' }

test('UICP-01: vi and en have the same keys and the same ICU arguments', () => {
  expect(compareCatalogs(CATALOGS.en, CATALOGS.vi, names)).toEqual([])
})

describe('UICP-02: a difference fails and names the key', () => {
  const check = (en: string, vi: string) => compareCatalogs({ k: en }, { k: vi }, names)

  test('a renamed placeholder', () => {
    expect(check('Try again in {minutes} minutes.', 'Thử lại sau {minute} phút.')).toEqual([
      'k: arguments differ (en: minutes:plain; vi: minute:plain)',
    ])
  })

  test('a dropped placeholder', () => {
    expect(check('Reference: {requestId}', 'Mã tham chiếu')).toHaveLength(1)
  })

  test('a missing key on either side', () => {
    expect(compareCatalogs({ a: 'x', b: 'y' }, { a: 'x', c: 'z' }, names)).toEqual([
      'b: missing in vi',
      'c: missing in en',
    ])
  })

  test('select options that differ', () => {
    expect(
      check(
        '{t, select, owner {Owner} other {}}',
        '{t, select, owner {Chủ} tenant {Thuê} other {}}',
      ),
    ).toHaveLength(1)
  })

  test('a date where the other language has a number', () => {
    expect(check('{when, date}', '{when, number}')).toHaveLength(1)
  })

  test('an empty or unparseable message', () => {
    expect(check('Saved', ' ')).toEqual(['k: empty message'])
    expect(check('Saved {', 'Đã lưu')[0]).toStartWith('k: not a valid ICU message')
  })
})

test('DR-224: a Vietnamese plain argument matches an English plural of the same name', () => {
  expect(
    compareCatalogs(
      { k: '{count, plural, one {# day left} other {# days left}}' },
      { k: 'Còn {count} ngày' },
      names,
    ),
  ).toEqual([])
  expect(messageArguments('{count, plural, one {# day} other {# days}}').get('count')).toEqual(
    new Set(['number']),
  )
})
