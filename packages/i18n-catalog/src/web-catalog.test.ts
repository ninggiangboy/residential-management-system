import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CATALOGS } from './catalog'
import { createTranslator, errorText, loadWebLanguage } from './web'
import { WEB_CATALOGS } from './web-catalog'

const WEB_FAMILIES = ['error', 'status', 'common', 'auth', 'offline', 'upgrade', 'web']
const family = (key: string) => key.split('.')[0]!

describe('the web CMS catalog keeps the app and server families out of its bundle (DR-179)', () => {
  test.each(['vi', 'en'] as const)(
    '%s holds the shared and web families and nothing else',
    (lang) => {
      const families = new Set(Object.keys(WEB_CATALOGS[lang]).map(family))
      expect([...families].filter((f) => !WEB_FAMILIES.includes(f))).toEqual([])
      for (const [key, text] of Object.entries(CATALOGS[lang]))
        if (WEB_FAMILIES.includes(family(key)) && !key.startsWith('common.import.'))
          expect([key, WEB_CATALOGS[lang][key as keyof typeof CATALOGS.en]]).toEqual([key, text])
    },
  )

  test('every key the web sources write as a literal is in it', () => {
    const root = join(import.meta.dir, '../../../apps/cms-web/src')
    const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) =>
      /\.tsx?$/.test(f),
    )
    const used = new Set<string>()
    for (const file of files)
      for (const [, key] of readFileSync(join(root, file), 'utf8').matchAll(
        /['"`]([a-z-]+(?:\.[a-z0-9_-]+)+)['"`]/g,
      ))
        if (key! in CATALOGS.en) used.add(key!)
    expect([...used].filter((key) => !(key in WEB_CATALOGS.en))).toEqual([])
    expect(used.size).toBeGreaterThan(50)
  })
})

await loadWebLanguage('en')

describe('the web translator', () => {
  test('English is loaded on demand, Vietnamese is there at once (DR-308)', async () => {
    expect(createTranslator('vi')('common.action.cancel')).toBe(
      WEB_CATALOGS.vi['common.action.cancel']!,
    )
    await loadWebLanguage('en')
    expect(createTranslator('en')('common.action.cancel')).toBe(
      WEB_CATALOGS.en['common.action.cancel']!,
    )
  })

  const t = createTranslator('en')
  test('translates its keys and knows which it has', () => {
    expect(t('common.error.page.body')).toBeTruthy()
    expect(t.has('error.account_locked')).toBe(true)
    expect(t.has('res.login.cta')).toBe(false)
  })

  test('errorText falls back to the server message for a code without copy', () => {
    expect(errorText(t, { code: 'no_such_code', message: 'From the server' })).toBe(
      'From the server',
    )
  })
})
