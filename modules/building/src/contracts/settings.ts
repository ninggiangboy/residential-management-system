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
      defaultLanguage: Type.Union([Type.String(), Type.Null()], {
        description:
          'The language new accounts start with: `vi` or `en`. `null` restores the default',
      }),
      defaultDueDays: Type.Union([Type.Integer(), Type.Null()], {
        description:
          'Days from the issue of a fee to its due date, 1…60. `null` restores the default',
      }),
      accountDeletionDays: Type.Union([Type.Integer(), Type.Null()], {
        description:
          'Days between the approval of an account deletion and its execution, 1…365. `null` restores the default',
      }),
      lockout: Type.Union(
        [
          Type.Object(
            {
              maxAttempts: Type.Integer({
                description: 'Failed sign-ins before the account is locked for a while, 3…10',
              }),
              minutes: Type.Integer({ description: 'Minutes the account stays locked, 5…120' }),
            },
            { additionalProperties: false },
          ),
          Type.Null(),
        ],
        {
          description:
            'The temporary lock after failed sign-ins. Always sent whole. `null` restores the default',
        },
      ),
      maxCarsPerUnit: Type.Union([Type.Integer(), Type.Null()], {
        description: 'How many cars one unit may register, 1…20. `null` restores the default',
      }),
      storageQuotaBytes: Type.Union([Type.Integer(), Type.Null()], {
        description:
          'The file storage of the building in bytes, 1 GiB…1 TiB. `null` restores the default',
      }),
      feeNoticeLanguage: Type.Union([Type.String(), Type.Null()], {
        description:
          'The language of fee notices: `vi`, `en` or `both`. `null` restores the default',
      }),
      reportColumns: Type.Union([ReportColumns, Type.Null()], {
        description: 'The columns of each report, by report name. `null` restores the default',
      }),
    },
    { additionalProperties: false },
  ),
  {
    description:
      'A shallow merge: a key present is set, a key `null` is removed (back to its default), a key absent is untouched.',
  },
)

export type SettingsShape = Static<typeof SettingsShapeSchema>
export type SettingsPatch = Static<typeof SettingsPatchSchema>

const Nullable = <T extends ReturnType<typeof Type.String>>(schema: T) =>
  Type.Union([schema, Type.Null()])

const BilingualText = (description: string) =>
  Type.Object(
    {
      vi: Type.String({ description: 'The Vietnamese text' }),
      en: Type.Optional(Type.String({ description: 'The English text' })),
    },
    { additionalProperties: false, description },
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
      name: BilingualText('The name of the building'),
      company: Type.Object(
        {
          name: BilingualText('The name of the management company'),
          taxCode: Type.Optional(Type.String({ description: 'The tax code of the company' })),
          address: Type.Optional(Type.String({ description: 'The address of the company' })),
          phone: Type.Optional(Type.String({ description: 'The phone of the company' })),
          email: Type.Optional(Type.String({ description: 'The email of the company' })),
          representative: Type.Optional(
            Type.String({ description: 'The legal representative of the company' }),
          ),
        },
        {
          additionalProperties: false,
          description: 'The management company, printed on fee notices and receipts',
        },
      ),
      address: Type.String({ description: 'The address of the building' }),
      hotline: Nullable(
        Type.String({ description: 'The hotline shown to residents; `null` removes it' }),
      ),
      workingHours: Type.Union([BilingualText('The office hours'), Type.Null()], {
        description: 'The office hours shown to residents; `null` removes them',
      }),
      email: Nullable(
        Type.String({ description: 'The contact email shown to residents; `null` removes it' }),
      ),
      logoFileId: Nullable(
        Type.String({
          pattern: '^[0-9a-fA-F-]{36}$',
          description: 'The id of a verified `logo` upload; `null` removes the logo',
        }),
      ),
    },
    { additionalProperties: false },
  ),
  {
    description:
      'Only the fields to change. `code`, `timeZone` and `isDemo` cannot be edited and are refused as `unknown_key`.',
  },
)

/** The body of `PATCH /staff/settings`: either part, or both, in one transaction. */
export const SettingsUpdateSchema = Type.Object(
  {
    building: Type.Optional(BuildingPatchSchema),
    settings: Type.Optional(SettingsPatchSchema),
  },
  { additionalProperties: false },
)

export type BuildingPatchBody = Static<typeof BuildingPatchSchema>
export type SettingsUpdateBody = Static<typeof SettingsUpdateSchema>
