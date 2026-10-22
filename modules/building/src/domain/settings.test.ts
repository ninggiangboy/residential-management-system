import { describe, expect, test } from 'bun:test'
import { RuleViolationError } from '@core/kernel'
import { DEFAULT_SETTINGS } from '../contracts'
import { assertPatchInRange, mergeSettings, resolveSettings } from './settings'

describe('settings (DOC-17 §1.2, DOC-36 §5)', () => {
  test('BD-04 the defaults are the code defaults of the table', () => {
    expect(resolveSettings({})).toEqual({
      defaultLanguage: 'vi',
      defaultDueDays: 10,
      accountDeletionDays: 30,
      lockout: { maxAttempts: 5, minutes: 15 },
      maxCarsPerUnit: 2,
      storageQuotaBytes: 53_687_091_200,
      feeNoticeLanguage: 'vi',
      reportColumns: {},
    })
    expect(resolveSettings({})).not.toBe(DEFAULT_SETTINGS)
  })

  test('BD-04 saved keys overlay the defaults and a nested key overlays one member only', () => {
    const settings = resolveSettings({
      defaultDueDays: 12,
      lockout: { minutes: 30 },
      reportColumns: { debt: ['unit', 'amount'] },
    })
    expect(settings.defaultDueDays).toBe(12)
    expect(settings.lockout).toEqual({ maxAttempts: 5, minutes: 30 })
    expect(settings.reportColumns).toEqual({ debt: ['unit', 'amount'] })
  })

  test('BD-04 a stored value outside its rule falls back to the default and is reported', () => {
    const reported: string[] = []
    const settings = resolveSettings(
      {
        defaultDueDays: 999,
        feeNoticeLanguage: 'fr',
        maxCarsPerUnit: 2.5,
        accountDeletionDays: 'soon',
      },
      (path, reason) => reported.push(`${path}:${reason}`),
    )
    expect(settings.defaultDueDays).toBe(10)
    expect(settings.feeNoticeLanguage).toBe('vi')
    expect(settings.maxCarsPerUnit).toBe(2)
    expect(settings.accountDeletionDays).toBe(30)
    expect(reported.sort()).toEqual([
      'accountDeletionDays:type',
      'defaultDueDays:range',
      'feeNoticeLanguage:enum',
      'maxCarsPerUnit:type',
    ])
  })

  test('BD-02 the bounds are inclusive and every breach names the setting', () => {
    for (const ok of [
      { defaultDueDays: 1 },
      { defaultDueDays: 60 },
      { lockout: { maxAttempts: 3, minutes: 5 } },
      { storageQuotaBytes: 1_073_741_824 },
    ])
      expect(() => assertPatchInRange(ok as never)).not.toThrow()
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ defaultDueDays: 0 }, 'settings.defaultDueDays'],
      [{ defaultDueDays: 61 }, 'settings.defaultDueDays'],
      [{ accountDeletionDays: 366 }, 'settings.accountDeletionDays'],
      [{ lockout: { maxAttempts: 11, minutes: 15 } }, 'settings.lockout.maxAttempts'],
      [{ lockout: { maxAttempts: 5, minutes: 121 } }, 'settings.lockout.minutes'],
      [{ storageQuotaBytes: 1_073_741_823 }, 'settings.storageQuotaBytes'],
      [{ storageQuotaBytes: 1_099_511_627_777 }, 'settings.storageQuotaBytes'],
      [{ defaultLanguage: 'fr' }, 'settings.defaultLanguage'],
    ]
    for (const [patch, path] of bad) {
      try {
        assertPatchInRange(patch as never)
        throw new Error(`no error for ${path}`)
      } catch (error) {
        expect(error).toBeInstanceOf(RuleViolationError)
        expect((error as RuleViolationError).details).toEqual([
          expect.objectContaining({ code: 'setting_invalid', path }),
        ])
      }
    }
    // null removes a key: always allowed
    expect(() => assertPatchInRange({ defaultDueDays: null } as never)).not.toThrow()
  })

  test('BD-05 a merge sets, removes and leaves alone; the diff lists the effective changes only', () => {
    const merge = mergeSettings(
      { defaultDueDays: 12, maxCarsPerUnit: 3 },
      { defaultDueDays: 15, feeNoticeLanguage: 'both', maxCarsPerUnit: null },
    )
    expect(merge.set).toEqual({ defaultDueDays: 15, feeNoticeLanguage: 'both' })
    expect(merge.remove).toEqual(['maxCarsPerUnit'])
    expect(merge.data).toEqual({ defaultDueDays: 15, feeNoticeLanguage: 'both' })
    expect(merge.changes).toEqual([
      { field: 'defaultDueDays', before: 12, after: 15 },
      { field: 'maxCarsPerUnit', before: 3, after: 2 },
      { field: 'feeNoticeLanguage', before: 'vi', after: 'both' },
    ])
  })

  test('a value saved again unchanged, or a removed key that was a default, is not a change', () => {
    expect(mergeSettings({ defaultDueDays: 12 }, { defaultDueDays: 12 }).changes).toEqual([])
    expect(mergeSettings({}, { defaultDueDays: 10, maxCarsPerUnit: null }).changes).toEqual([])
  })

  test('lockout is replaced whole: both members change in the diff', () => {
    const merge = mergeSettings({}, { lockout: { maxAttempts: 7, minutes: 30 } })
    expect(merge.changes).toEqual([
      { field: 'lockout.maxAttempts', before: 5, after: 7 },
      { field: 'lockout.minutes', before: 15, after: 30 },
    ])
  })
})
