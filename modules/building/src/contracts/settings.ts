import { type Static, Type } from '@sinclair/typebox'

/**
 * The settings of a building (DOC-17 §1.2, DOC-36 §3.2, §5). The database holds only the keys an Admin saved; the code
 * defaults below are overlaid by what was saved, so a new key needs no migration and no backfill (DR-111).
 */
export interface BuildingSettings {
  defaultLanguage: 'vi' | 'en'
  defaultDueDays: number
  accountDeletionDays: number
  lockout: { maxAttempts: number; minutes: number }
  maxCarsPerUnit: number
  storageQuotaBytes: number
  feeNoticeLanguage: 'vi' | 'en' | 'both'
  reportColumns: Record<string, string[]>
}

export const GIB = 1_073_741_824

export const DEFAULT_SETTINGS: BuildingSettings = {
  defaultLanguage: 'vi',
  defaultDueDays: 10,
  accountDeletionDays: 30,
  lockout: { maxAttempts: 5, minutes: 15 },
  maxCarsPerUnit: 2,
  storageQuotaBytes: 50 * GIB,
  feeNoticeLanguage: 'vi',
  reportColumns: {},
}

/**
 * The table of ranges and enumerations (DOC-36 §5.1). The use case checks it after the shape passes, and a value outside it is
 * 422 `setting_invalid` with the path of the setting, so the Admin sees which one is out of range (FR-38.2).
 */
export const SETTING_RULES = {
  defaultLanguage: { oneOf: ['vi', 'en'] },
  defaultDueDays: { min: 1, max: 60 },
  accountDeletionDays: { min: 1, max: 365 },
  'lockout.maxAttempts': { min: 3, max: 10 },
  'lockout.minutes': { min: 5, max: 120 },
  maxCarsPerUnit: { min: 1, max: 20 },
  storageQuotaBytes: { min: GIB, max: 1024 * GIB },
  feeNoticeLanguage: { oneOf: ['vi', 'en', 'both'] },
} as const

export type SettingPath = keyof typeof SETTING_RULES

const ReportColumns = Type.Record(
  Type.String({ pattern: '^[a-z_]+$' }),
  Type.Array(Type.String({ pattern: '^[a-zA-Z0-9_.]+$' }), { maxItems: 40 }),
)

/**
 * Names and types only, `additionalProperties: false` everywhere: a misspelled key or a wrong type is 400 `validation_failed`
 * (`unknown_key`, `type`). The ranges are `SETTING_RULES` (DOC-36 §5.1).
 */
export const SettingsShapeSchema = Type.Object(
  {
    defaultLanguage: Type.String(),
    defaultDueDays: Type.Integer(),
    accountDeletionDays: Type.Integer(),
    lockout: Type.Object(
      { maxAttempts: Type.Integer(), minutes: Type.Integer() },
      { additionalProperties: false },
    ),
    maxCarsPerUnit: Type.Integer(),
    storageQuotaBytes: Type.Integer(),
    feeNoticeLanguage: Type.String(),
    reportColumns: ReportColumns,
  },
  { additionalProperties: false },
)

/**
 * A `PATCH` body: the same shape with every key optional and nullable (`null` removes a saved key). `lockout` is always sent
 * whole, so the shallow merge cannot leave half of it.
 */
export const SettingsPatchSchema = Type.Partial(
  Type.Object(
    {
      defaultLanguage: Type.Union([Type.String(), Type.Null()]),
      defaultDueDays: Type.Union([Type.Integer(), Type.Null()]),
      accountDeletionDays: Type.Union([Type.Integer(), Type.Null()]),
      lockout: Type.Union([
        Type.Object(
          { maxAttempts: Type.Integer(), minutes: Type.Integer() },
          { additionalProperties: false },
        ),
        Type.Null(),
      ]),
      maxCarsPerUnit: Type.Union([Type.Integer(), Type.Null()]),
      storageQuotaBytes: Type.Union([Type.Integer(), Type.Null()]),
      feeNoticeLanguage: Type.Union([Type.String(), Type.Null()]),
      reportColumns: Type.Union([ReportColumns, Type.Null()]),
    },
    { additionalProperties: false },
  ),
)

export type SettingsShape = Static<typeof SettingsShapeSchema>
export type SettingsPatch = Static<typeof SettingsPatchSchema>

const Nullable = <T extends ReturnType<typeof Type.String>>(schema: T) =>
  Type.Union([schema, Type.Null()])

const BilingualText = Type.Object(
  { vi: Type.String(), en: Type.Optional(Type.String()) },
  { additionalProperties: false },
)

/**
 * The `building` part of `PATCH /staff/settings` (DOC-36 §4.1): only the fields to change. `code`, `timeZone` and `isDemo` are
 * not editable, so `additionalProperties: false` rejects them with 400 `validation_failed` (a time-zone change moves every
 * "today" of the building and is a migration with a DR, not a form, DR-126). The length and format rules of §4.2 are checked by
 * the use case.
 */
export const BuildingPatchSchema = Type.Partial(
  Type.Object(
    {
      name: BilingualText,
      company: Type.Object(
        {
          name: BilingualText,
          taxCode: Type.Optional(Type.String()),
          address: Type.Optional(Type.String()),
          phone: Type.Optional(Type.String()),
          email: Type.Optional(Type.String()),
          representative: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
      address: Type.String(),
      hotline: Nullable(Type.String()),
      workingHours: Type.Union([BilingualText, Type.Null()]),
      email: Nullable(Type.String()),
      logoFileId: Nullable(Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })),
    },
    { additionalProperties: false },
  ),
)

/** The body of `PATCH /staff/settings`: either part, or both, in one transaction. */
export const SettingsUpdateSchema = Type.Object(
  { building: Type.Optional(BuildingPatchSchema), settings: Type.Optional(SettingsPatchSchema) },
  { additionalProperties: false },
)

export type BuildingPatchBody = Static<typeof BuildingPatchSchema>
export type SettingsUpdateBody = Static<typeof SettingsUpdateSchema>
