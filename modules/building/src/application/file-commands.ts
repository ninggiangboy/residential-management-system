import type { DomainEvent } from '@core/kernel'
import { BUILDING_EVENTS } from '../contracts'
import type { FileRecord } from '../domain/file-object'

/** The command `building` writes in the transaction that moves a file to `deleted` (DR-122). */
export const deleteCommand = (
  file: Pick<FileRecord, 'id' | 'buildingId'>,
  now: Date,
): DomainEvent => ({
  type: BUILDING_EVENTS.fileDeleteRequested,
  aggregateId: file.id,
  payload: { buildingId: file.buildingId, fileId: file.id },
  occurredAt: now,
})

/** The command that asks the worker for a thumbnail of a verified image (DR-122). */
export const thumbnailCommand = (
  file: Pick<FileRecord, 'id' | 'buildingId'>,
  now: Date,
): DomainEvent => ({
  type: BUILDING_EVENTS.thumbnailRequested,
  aggregateId: file.id,
  payload: { buildingId: file.buildingId, fileId: file.id },
  occurredAt: now,
})
