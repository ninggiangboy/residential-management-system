import { describe, expect, test } from 'bun:test'
import { isTermsError, parseTermsMarkdown, TERMS_MAX_BYTES } from './terms-markdown'

const rule = (text: string) => {
  const result = parseTermsMarkdown(text)
  return isTermsError(result) ? `${result.rule}@${result.line}` : 'ok'
}

describe('the Markdown subset of the terms (DOC-36 §8)', () => {
  test('BD-44 a ## heading, a list, bold, italic, a break and an https link are accepted', () => {
    const result = parseTermsMarkdown(
      [
        '## 1. Scope',
        'Fees are paid **in full** per *charge*.',
        'A second line.',
        '',
        '### Owners',
        '- first',
        '  - nested',
        '- second with [the site](https://example.com/terms)',
        '',
        '1. one',
        '2. two',
      ].join('\n'),
    )
    expect(isTermsError(result)).toBe(false)
    if (isTermsError(result)) return
    expect(result.map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading', 'list', 'list'])
    const paragraph = result[1]
    expect(paragraph?.type === 'paragraph' && paragraph.inline.map((i) => i.type)).toEqual([
      'text',
      'bold',
      'text',
      'italic',
      'text',
      'break',
      'text',
    ])
    const bullets = result[3]
    expect(bullets?.type === 'list' && bullets.items[0]?.children).toHaveLength(1)
    expect(result[4]?.type === 'list' && result[4].ordered).toBe(true)
  })

  test('BD-44 an HTML tag, an image, a http link, a # heading and a table are each refused with the line', () => {
    expect(rule('## ok\n\nA <b>bold</b> word')).toBe('html@3')
    expect(rule('## ok\n\n![logo](https://example.com/a.png)')).toBe('image@3')
    expect(rule('## ok\n[read](http://example.com)')).toBe('link@2')
    expect(rule('[x](javascript:alert(1))')).toBe('link@1')
    expect(rule('[x](/relative/path)')).toBe('link@1')
    expect(rule('# Title\n\ntext')).toBe('heading_level@1')
    expect(rule('#### Deep')).toBe('heading_level@1')
    expect(rule('## ok\n| a | b |\n|---|---|')).toBe('table@2')
    expect(rule('some `code` here')).toBe('code@1')
    expect(rule('para\n\n    indented code')).toBe('code@3')
    expect(rule('- a\n  - b\n      - c')).toBe('indent@3')
  })

  test('BD-44 101 KB is refused, and so is an empty text', () => {
    expect(rule('x'.repeat(TERMS_MAX_BYTES + 1))).toBe('too_large@1')
    expect(rule('x'.repeat(TERMS_MAX_BYTES))).toBe('ok')
    expect(rule('  \n ')).toBe('empty@1')
  })

  test('an unmatched marker stays literal, and Vietnamese text passes through', () => {
    const result = parseTermsMarkdown('Giá 2 * 3 và *chưa đóng')
    expect(isTermsError(result)).toBe(false)
    if (isTermsError(result)) return
    const paragraph = result[0]
    expect(paragraph?.type === 'paragraph' && paragraph.inline).toEqual([
      { type: 'text', text: 'Giá 2 * 3 và *chưa đóng' },
    ])
  })
})
