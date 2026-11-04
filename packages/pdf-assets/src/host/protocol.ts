/**
 * The message shapes of the render-host IPC channel (DOC-34 §4.1, DR-291). The parent sends a
 * {@link RenderRequest}; the child answers with a {@link RenderResponse} that echoes the `id`. The
 * channel uses Bun's advanced serialization, so `input` and the PDF `bytes` cross as structured
 * clones.
 */
export interface RenderRequest {
  id: number
  kind: string
  input: unknown
}

export interface RenderSuccess {
  id: number
  ok: true
  bytes: Uint8Array
  rssBytes: number
}

export interface RenderFailure {
  id: number
  ok: false
  message: string
}

export type RenderResponse = RenderSuccess | RenderFailure
