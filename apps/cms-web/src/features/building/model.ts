import type { api } from '../../api/client'

/** The document of E-47/E-48 (the read has a 304 branch, so the type is the one E-48 answers). */
export type BuildingDocument = NonNullable<
  Awaited<ReturnType<typeof api.staff.settings.patch>>['data']
>

const GIB = 1_073_741_824

export interface BuildingFormValues {
  nameVi: string
  nameEn: string
  companyNameVi: string
  companyNameEn: string
  taxCode: string
  companyAddress: string
  companyPhone: string
  companyEmail: string
  representative: string
  address: string
  hotline: string
  email: string
  hoursVi: string
  hoursEn: string
  defaultDueDays: string
  defaultLanguage: 'vi' | 'en'
  maxAttempts: string
  lockMinutes: string
  accountDeletionDays: string
  maxCarsPerUnit: string
  quotaGb: string
  feeNoticeLanguage: 'vi' | 'en' | 'both'
}

const FIELD_NAMES = [
  'nameVi',
  'nameEn',
  'companyNameVi',
  'companyNameEn',
  'taxCode',
  'companyAddress',
  'companyPhone',
  'companyEmail',
  'representative',
  'address',
  'hotline',
  'email',
  'hoursVi',
  'hoursEn',
  'defaultDueDays',
  'defaultLanguage',
  'maxAttempts',
  'lockMinutes',
  'accountDeletionDays',
  'maxCarsPerUnit',
  'quotaGb',
  'feeNoticeLanguage',
] as const satisfies readonly (keyof BuildingFormValues)[]

/** Where each API path lands in the form: a `details[].path` of `setting_invalid` or `validation_failed` names its field (DOC-67 §6). */
const PATH_TO_FIELD: Readonly<Record<string, keyof BuildingFormValues>> = {
  'name.vi': 'nameVi',
  'name.en': 'nameEn',
  'company.name.vi': 'companyNameVi',
  'company.name.en': 'companyNameEn',
  'company.taxCode': 'taxCode',
  'company.address': 'companyAddress',
  'company.phone': 'companyPhone',
  'company.email': 'companyEmail',
  'company.representative': 'representative',
  address: 'address',
  hotline: 'hotline',
  email: 'email',
  'workingHours.vi': 'hoursVi',
  'workingHours.en': 'hoursEn',
  defaultDueDays: 'defaultDueDays',
  defaultLanguage: 'defaultLanguage',
  'lockout.maxAttempts': 'maxAttempts',
  'lockout.minutes': 'lockMinutes',
  accountDeletionDays: 'accountDeletionDays',
  maxCarsPerUnit: 'maxCarsPerUnit',
  storageQuotaBytes: 'quotaGb',
  feeNoticeLanguage: 'feeNoticeLanguage',
}

/** The field for a path like `settings.lockout.minutes` or `building.name.vi`. */
export const fieldOfPath = (path: string): keyof BuildingFormValues | undefined =>
  PATH_TO_FIELD[path.replace(/^(building|settings)\./, '')]

export function valuesOf(doc: BuildingDocument): BuildingFormValues {
  const { building, settings } = doc
  const company = building.company
  return {
    nameVi: building.name.vi,
    nameEn: building.name.en ?? '',
    companyNameVi: company.name.vi,
    companyNameEn: company.name.en ?? '',
    taxCode: company.taxCode ?? '',
    companyAddress: company.address ?? '',
    companyPhone: company.phone ?? '',
    companyEmail: company.email ?? '',
    representative: company.representative ?? '',
    address: building.address,
    hotline: building.hotline ?? '',
    email: building.email ?? '',
    hoursVi: building.workingHours?.vi ?? '',
    hoursEn: building.workingHours?.en ?? '',
    defaultDueDays: String(settings.defaultDueDays),
    defaultLanguage: settings.defaultLanguage,
    maxAttempts: String(settings.lockout.maxAttempts),
    lockMinutes: String(settings.lockout.minutes),
    accountDeletionDays: String(settings.accountDeletionDays),
    maxCarsPerUnit: String(settings.maxCarsPerUnit),
    quotaGb: String(Math.round((settings.storageQuotaBytes / GIB) * 100) / 100),
    feeNoticeLanguage: settings.feeNoticeLanguage,
  }
}

const same = <K extends keyof BuildingFormValues>(
  a: BuildingFormValues,
  b: BuildingFormValues,
  ...keys: K[]
) => keys.every((key) => a[key].trim() === b[key].trim())

export interface BuildingPatch {
  building?: Record<string, unknown>
  settings?: Record<string, unknown>
}

/** `"12"` → 12; anything else stays a string so the server's range message reaches the field instead of a silent `NaN`. */
const whole = (text: string): number | string =>
  /^\d+$/.test(text.trim()) ? Number(text.trim()) : text.trim()

/**
 * Only what changed (UIWS-17): a part is sent whole when any of its fields changed (`name`, `company`, `workingHours`, `lockout`), so
 * the API never merges half of it. An optional text that is cleared becomes `null`; a logo change joins the `building` part.
 */
export function buildPatch(
  values: BuildingFormValues,
  original: BuildingFormValues,
  logo: { fileId: string | null } | null,
): BuildingPatch {
  const building: Record<string, unknown> = {}
  const settings: Record<string, unknown> = {}
  const text = (v: string) => v.trim()

  if (!same(values, original, 'nameVi', 'nameEn'))
    building.name = {
      vi: text(values.nameVi),
      ...(text(values.nameEn) ? { en: text(values.nameEn) } : {}),
    }
  if (
    !same(
      values,
      original,
      'companyNameVi',
      'companyNameEn',
      'taxCode',
      'companyAddress',
      'companyPhone',
      'companyEmail',
      'representative',
    )
  ) {
    const optional = (key: string, v: string) => (text(v) ? { [key]: text(v) } : {})
    building.company = {
      name: {
        vi: text(values.companyNameVi),
        ...(text(values.companyNameEn) ? { en: text(values.companyNameEn) } : {}),
      },
      ...optional('taxCode', values.taxCode),
      ...optional('address', values.companyAddress),
      ...optional('phone', values.companyPhone),
      ...optional('email', values.companyEmail),
      ...optional('representative', values.representative),
    }
  }
  if (!same(values, original, 'address')) building.address = text(values.address)
  if (!same(values, original, 'hotline')) building.hotline = text(values.hotline) || null
  if (!same(values, original, 'email')) building.email = text(values.email) || null
  if (!same(values, original, 'hoursVi', 'hoursEn'))
    building.workingHours =
      text(values.hoursVi) || text(values.hoursEn)
        ? {
            vi: text(values.hoursVi),
            ...(text(values.hoursEn) ? { en: text(values.hoursEn) } : {}),
          }
        : null
  if (logo) building.logoFileId = logo.fileId

  if (!same(values, original, 'defaultDueDays'))
    settings.defaultDueDays = whole(values.defaultDueDays)
  if (values.defaultLanguage !== original.defaultLanguage)
    settings.defaultLanguage = values.defaultLanguage
  if (!same(values, original, 'maxAttempts', 'lockMinutes'))
    settings.lockout = {
      maxAttempts: whole(values.maxAttempts),
      minutes: whole(values.lockMinutes),
    }
  if (!same(values, original, 'accountDeletionDays'))
    settings.accountDeletionDays = whole(values.accountDeletionDays)
  if (!same(values, original, 'maxCarsPerUnit'))
    settings.maxCarsPerUnit = whole(values.maxCarsPerUnit)
  if (!same(values, original, 'quotaGb')) {
    const gb = Number(values.quotaGb.replace(',', '.'))
    settings.storageQuotaBytes = Number.isFinite(gb) ? Math.round(gb * GIB) : values.quotaGb
  }
  if (values.feeNoticeLanguage !== original.feeNoticeLanguage)
    settings.feeNoticeLanguage = values.feeNoticeLanguage

  return {
    ...(Object.keys(building).length > 0 ? { building } : {}),
    ...(Object.keys(settings).length > 0 ? { settings } : {}),
  }
}

/** The ranges of DOC-36 §5.1: the same table as the API's, so every out-of-range field is named at once, not one per request (UIWS-18). */
const RANGES: ReadonlyArray<readonly [keyof BuildingFormValues, number, number]> = [
  ['defaultDueDays', 1, 60],
  ['accountDeletionDays', 1, 365],
  ['maxAttempts', 3, 10],
  ['lockMinutes', 5, 120],
  ['maxCarsPerUnit', 1, 20],
  ['quotaGb', 1, 1024],
]

/** The fields whose value is not a number inside its range; empty when the form may be sent. */
export function outOfRange(values: BuildingFormValues): (keyof BuildingFormValues)[] {
  return RANGES.filter(([field, min, max]) => {
    const value = Number(values[field].trim().replace(',', '.'))
    return !Number.isFinite(value) || value < min || value > max || values[field].trim() === ''
  }).map(([field]) => field)
}

export const isEmptyPatch = (patch: BuildingPatch) =>
  patch.building === undefined && patch.settings === undefined
