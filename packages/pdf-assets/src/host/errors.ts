/**
 * The failure codes a pool request can carry (DOC-34 §10, DR-291):
 * - `busy`: the request waited past `waitTimeoutMs` for a free host.
 * - `timeout`: the render passed `renderTimeoutMs`; the host was killed and replaced.
 * - `host_exited`: the host died while the render was pending; a fresh host takes over.
 * - `render_failed`: the child's `renderToBuffer` threw and the host stays alive.
 */
export type PdfRenderErrorCode = 'busy' | 'timeout' | 'host_exited' | 'render_failed'

export class PdfRenderError extends Error {
  readonly code: PdfRenderErrorCode

  constructor(code: PdfRenderErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'PdfRenderError'
    this.code = code
  }
}
