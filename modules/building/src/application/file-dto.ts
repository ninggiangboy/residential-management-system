import type { FileDto } from '../contracts'
import type { FileRecord } from '../domain/file-object'

export const toFileDto = (file: FileRecord): FileDto => ({
  fileId: file.id,
  purpose: file.purpose,
  mime: file.mime,
  size: file.size,
  status: file.status,
  createdAt: file.createdAt.toISOString(),
})
