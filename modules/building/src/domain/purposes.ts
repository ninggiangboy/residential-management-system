import type { StaffRole } from '@rms/shared-types'
import type { FileModule, Purpose } from '../contracts'

/** The limits of DOC-37 §11.1, in bytes; the composition root fills them from `FILES_MAX_*`. */
export interface FileLimits {
  imageBytes: number
  videoBytes: number
  attachmentBytes: number
  importBytes: number
  logoBytes: number
  generatedBytes: number
}

type LimitKey = keyof FileLimits | number

export interface PurposeRule {
  /** The owning modules the purpose may be registered for: one, except `import` (residency or finance). */
  modules: readonly FileModule[]
  /** Who registers it. `system` purposes are written by the worker and refused at `register` (403). */
  audience: { resident?: true; staff?: readonly StaffRole[]; system?: true }
  mimes: readonly string[]
  /** The maximum, by mime (`ticket_media` has one for images and one for videos). */
  limit: (mime: string) => LimitKey
  /** Which width the thumbnail worker uses, or none. */
  thumbnail: 'thumb' | 'logo' | null
  /** `paper` is the 5-minute URL of a vehicle paper (FR-40.4). */
  url: 'download' | 'paper'
}

const IMAGES = ['image/jpeg', 'image/png', 'image/webp'] as const
const VIDEOS = ['video/mp4', 'video/quicktime'] as const
export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const ATTACHMENTS = ['application/pdf', MIME_DOCX, MIME_XLSX, MIME_PPTX, 'image/jpeg', 'image/png']

const MANAGER_ADMIN: readonly StaffRole[] = ['manager', 'admin']
const ANY_STAFF: readonly StaffRole[] = ['admin', 'manager', 'technician', 'guard']

/** The MIME to extension map: the extension ends the object key (DOC-37 §4). */
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/zip': 'zip',
  [MIME_XLSX]: 'xlsx',
  [MIME_DOCX]: 'docx',
  [MIME_PPTX]: 'pptx',
}

const MB = 1_048_576

/** DOC-37 §4, one row per purpose. */
export const PURPOSE_RULES: Readonly<Record<Purpose, PurposeRule>> = {
  avatar: {
    modules: ['identity'],
    audience: { resident: true, staff: ANY_STAFF },
    mimes: IMAGES,
    limit: () => 'imageBytes',
    thumbnail: 'thumb',
    url: 'download',
  },
  logo: {
    modules: ['building'],
    audience: { staff: ['admin'] },
    mimes: ['image/png', 'image/jpeg'],
    limit: () => 'logoBytes',
    thumbnail: 'logo',
    url: 'download',
  },
  import: {
    modules: ['residency', 'finance'],
    audience: { staff: MANAGER_ADMIN },
    mimes: [MIME_XLSX],
    limit: () => 'importBytes',
    thumbnail: null,
    url: 'download',
  },
  statement: {
    modules: ['finance'],
    audience: { staff: MANAGER_ADMIN },
    mimes: [MIME_XLSX, 'text/csv'],
    limit: () => 'importBytes',
    thumbnail: null,
    url: 'download',
  },
  ticket_media: {
    modules: ['tickets'],
    audience: { resident: true, staff: ['technician', 'manager', 'admin'] },
    mimes: [...IMAGES, ...VIDEOS],
    limit: (mime) => (mime.startsWith('video/') ? 'videoBytes' : 'imageBytes'),
    thumbnail: 'thumb',
    url: 'download',
  },
  vehicle_plate_photo: {
    modules: ['vehicles'],
    audience: { resident: true, staff: MANAGER_ADMIN },
    mimes: IMAGES,
    limit: () => 'imageBytes',
    thumbnail: 'thumb',
    url: 'download',
  },
  vehicle_paper: {
    modules: ['vehicles'],
    audience: { resident: true, staff: MANAGER_ADMIN },
    mimes: IMAGES,
    limit: () => 'imageBytes',
    thumbnail: null,
    url: 'paper',
  },
  notice_attachment: {
    modules: ['notices'],
    audience: { staff: MANAGER_ADMIN },
    mimes: ATTACHMENTS,
    limit: () => 'attachmentBytes',
    thumbnail: null,
    url: 'download',
  },
  notice_image: {
    modules: ['notices'],
    audience: { staff: MANAGER_ADMIN },
    mimes: IMAGES,
    limit: () => 'imageBytes',
    thumbnail: 'thumb',
    url: 'download',
  },
  wiki_attachment: {
    modules: ['wiki'],
    audience: { staff: MANAGER_ADMIN },
    mimes: ATTACHMENTS,
    limit: () => 'attachmentBytes',
    thumbnail: null,
    url: 'download',
  },
  wiki_image: {
    modules: ['wiki'],
    audience: { staff: MANAGER_ADMIN },
    mimes: IMAGES,
    limit: () => 'imageBytes',
    thumbnail: 'thumb',
    url: 'download',
  },
  fee_notice_pdf: {
    modules: ['finance'],
    audience: { system: true },
    mimes: ['application/pdf'],
    limit: () => 5 * MB,
    thumbnail: null,
    url: 'download',
  },
  receipt_pdf: {
    modules: ['finance'],
    audience: { system: true },
    mimes: ['application/pdf'],
    limit: () => 2 * MB,
    thumbnail: null,
    url: 'download',
  },
  bulk_zip: {
    modules: ['finance'],
    audience: { system: true },
    mimes: ['application/zip'],
    limit: () => 1024 * MB,
    thumbnail: null,
    url: 'download',
  },
  export: {
    modules: ['reporting'],
    audience: { system: true },
    mimes: [MIME_XLSX, 'application/pdf'],
    limit: () => 100 * MB,
    thumbnail: null,
    url: 'download',
  },
  thumbnail: {
    modules: ['identity', 'building', 'tickets', 'vehicles', 'notices', 'wiki'],
    audience: { system: true },
    mimes: ['image/webp'],
    limit: () => 1 * MB,
    thumbnail: null,
    url: 'download',
  },
}

/** The maximum size of a file of the purpose and mime. A generated file is also under `generatedBytes`. */
export function maxBytesFor(purpose: Purpose, mime: string, limits: FileLimits): number {
  const rule = PURPOSE_RULES[purpose]
  const key = rule.limit(mime)
  const bytes = typeof key === 'number' ? Math.min(key, limits.generatedBytes) : limits[key]
  return bytes
}

/** `jpg`, `png`, … or `undefined` for a type the system does not store. */
export const extensionOf = (mime: string): string | undefined => MIME_EXTENSIONS[mime]
