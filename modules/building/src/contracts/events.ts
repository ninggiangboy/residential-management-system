/**
 * The commands `building` writes to its own outbox (DOC-09 §6.9, DR-122). Both are commands, not facts: the handler decides
 * whether there is still something to do.
 */
export const BUILDING_EVENTS = {
  fileDeleteRequested: 'building.file_delete_requested.v1',
  thumbnailRequested: 'building.thumbnail_requested.v1',
} as const

export interface FileCommandPayload {
  buildingId: string
  fileId: string
}
