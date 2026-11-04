/**
 * The logo bytes the renderer prints (DOC-34 §8.4, DR-296): read once per render, `null` when it is missing. A port in
 * `application/`; the `FilesApi` adapter is `infrastructure/files-logo-source.ts`.
 */
export interface LogoSource {
  /** The logo of the snapshot's `company.logoKey` for this building; `null` for a missing or unreadable file, never throws. */
  load(buildingId: string, logoKey: string | null): Promise<Uint8Array | null>
}
