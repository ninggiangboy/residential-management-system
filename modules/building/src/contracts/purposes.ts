/**
 * The purposes of a file (DOC-37 §4, DOC-17 §3.1): a closed list, a value of the `CHECK` of `file_object.purpose`. A new one is
 * an expand migration of that `CHECK` (DR-112).
 */
export const UPLOAD_PURPOSES = [
  'avatar',
  'logo',
  'import',
  'statement',
  'ticket_media',
  'vehicle_plate_photo',
  'vehicle_paper',
  'notice_attachment',
  'notice_image',
  'wiki_attachment',
  'wiki_image',
] as const
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number]

/** Written by the system (the worker); `thumbnail` is the 480 px copy of an image (DR-122). */
export const GENERATED_PURPOSES = [
  'fee_notice_pdf',
  'receipt_pdf',
  'bulk_zip',
  'export',
  'thumbnail',
] as const
export type GeneratedPurpose = (typeof GENERATED_PURPOSES)[number]

export type Purpose = UploadPurpose | GeneratedPurpose

/** The modules that own files: the `CHECK` of `file_object.module`. */
export const FILE_MODULES = [
  'identity',
  'building',
  'residency',
  'finance',
  'tickets',
  'vehicles',
  'notices',
  'wiki',
  'reporting',
] as const
export type FileModule = (typeof FILE_MODULES)[number]

export type FileStatus = 'pending' | 'verified' | 'attached' | 'deleted'

/** Who registered an upload; `system` is the worker rendering a PDF (account id: the nil UUID). */
export type FileAccountKind = 'staff' | 'resident' | 'system'
export const SYSTEM_ACCOUNT_ID = '00000000-0000-0000-0000-000000000000'
