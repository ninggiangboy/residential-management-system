import type { FileModule } from '../contracts'

/**
 * `{env}/{building_id}/{module}/{yyyy}/{mm}/{uuid}.{ext}` for every object (DR-61, DR-86). `env` is the profile
 * (`local`, `staging`, `production`; `test` in tests); year and month are UTC and carry no business meaning; `id` is the
 * UUIDv7 of the `file_object`. The `CHECK` of the table refuses any other shape (FS-03).
 */
export function objectKeyOf(input: {
  env: string
  buildingId: string
  module: FileModule
  now: Date
  fileId: string
  extension: string
}): string {
  const year = input.now.getUTCFullYear()
  const month = String(input.now.getUTCMonth() + 1).padStart(2, '0')
  return `${input.env}/${input.buildingId}/${input.module}/${year}/${month}/${input.fileId}.${input.extension}`
}
