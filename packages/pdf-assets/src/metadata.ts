/**
 * The document info every template shares (DOC-34 §5, PD-29). react-pdf 4.9.0 stamps
 * `new Date()` as the creation date when none is given, so the same input would render to
 * different bytes; pinning both dates to a constant makes the output reproducible. The real
 * issue time is printed in the body from the snapshot, never taken from the PDF info.
 */
const PINNED_INSTANT = new Date('2026-01-01T00:00:00.000Z')

export const PDF_DOCUMENT_INFO = {
  creator: 'RMS',
  producer: 'RMS',
  creationDate: PINNED_INSTANT,
  modificationDate: PINNED_INSTANT,
} as const
