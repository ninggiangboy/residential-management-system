import { describe, expect, test } from 'bun:test'
import { type BuildingFormValues, buildPatch, fieldOfPath, isEmptyPatch } from './model'

const original: BuildingFormValues = {
  nameVi: 'Chung cư Sunrise A',
  nameEn: 'Sunrise A',
  companyNameVi: 'Công ty Sunrise',
  companyNameEn: '',
  taxCode: '',
  companyAddress: '',
  companyPhone: '',
  companyEmail: '',
  representative: '',
  address: '12 Nguyễn Huệ',
  hotline: '1900 1234',
  email: '',
  hoursVi: '',
  hoursEn: '',
  defaultDueDays: '10',
  defaultLanguage: 'vi',
  maxAttempts: '5',
  lockMinutes: '15',
  accountDeletionDays: '30',
  maxCarsPerUnit: '2',
  quotaGb: '50',
  feeNoticeLanguage: 'vi',
}

describe('UIWS-17: only the changed fields are sent', () => {
  test('nothing changed is an empty patch', () => {
    expect(isEmptyPatch(buildPatch(original, original, null))).toBe(true)
  })

  test('a hotline and the due days', () => {
    expect(
      buildPatch({ ...original, hotline: '1900 5678', defaultDueDays: '15' }, original, null),
    ).toEqual({
      building: { hotline: '1900 5678' },
      settings: { defaultDueDays: 15 },
    })
  })

  test('the lockout is always sent whole', () => {
    expect(buildPatch({ ...original, lockMinutes: '30' }, original, null).settings).toEqual({
      lockout: { maxAttempts: 5, minutes: 30 },
    })
  })

  test('a cleared optional text becomes null; the name keeps its English text only when typed', () => {
    expect(buildPatch({ ...original, hotline: '  ' }, original, null).building).toEqual({
      hotline: null,
    })
    expect(buildPatch({ ...original, nameEn: '' }, original, null).building).toEqual({
      name: { vi: 'Chung cư Sunrise A' },
    })
  })

  test('storage is sent in bytes; a text that is not a number reaches the server as it is', () => {
    expect(buildPatch({ ...original, quotaGb: '100' }, original, null).settings).toEqual({
      storageQuotaBytes: 100 * 1_073_741_824,
    })
    expect(buildPatch({ ...original, defaultDueDays: 'abc' }, original, null).settings).toEqual({
      defaultDueDays: 'abc',
    })
  })

  test('a new logo and a removed logo join the building part', () => {
    expect(buildPatch(original, original, { fileId: 'f1' }).building).toEqual({ logoFileId: 'f1' })
    expect(buildPatch(original, original, { fileId: null }).building).toEqual({ logoFileId: null })
  })
})

test('a path of the API lands on its field', () => {
  expect(fieldOfPath('settings.lockout.minutes')).toBe('lockMinutes')
  expect(fieldOfPath('building.name.vi')).toBe('nameVi')
  expect(fieldOfPath('defaultDueDays')).toBe('defaultDueDays')
  expect(fieldOfPath('nothing')).toBeUndefined()
})
