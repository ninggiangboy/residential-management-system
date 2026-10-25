import { ApiException, networkError } from '@rms/client-core'
import { api } from '../api/client'
import { apiErrorOf, unwrap } from '../api/errors'

export interface UploadInput {
  purpose: string
  /** Only an `import` names its module; a purpose with one module needs none (DOC-37 §4). */
  module?: string
  file: File
  /** The type the server is told (a CSV is `text/csv` from its extension, DOC-37 §4); defaults to the browser's. */
  mime?: string
  signal?: AbortSignal
}

/**
 * The upload of DOC-55 §12 for the web: register (E-36, its own `Idempotency-Key`), `PUT` to the presigned URL with exactly the
 * returned headers and no `Authorization` (the bucket is another origin and would refuse it), verify at once (E-37).
 * A refused or expired `PUT` registers again with a new key, once (DOC-37 §6.5). Returns the id the owning call carries.
 */
export async function uploadFile(input: UploadInput): Promise<{ fileId: string }> {
  const { file, signal } = input
  const mime = input.mime ?? file.type
  for (let attempt = 0; ; attempt++) {
    const ticket = unwrap(
      await api.staff.uploads.post(
        { purpose: input.purpose, module: input.module, mime, size: file.size },
        { headers: { 'idempotency-key': crypto.randomUUID() } },
      ),
    )
    let put: Response
    try {
      put = await fetch(ticket.url, { method: 'PUT', headers: ticket.headers, body: file, signal })
    } catch (thrown) {
      if (thrown instanceof DOMException && thrown.name === 'AbortError') throw thrown
      throw new ApiException(networkError('', 'The upload did not reach the store'))
    }
    if (!put.ok) {
      if (attempt === 0 && put.status === 403) continue
      throw new ApiException(networkError('', `The store answered ${put.status}`))
    }
    try {
      unwrap(await api.staff.uploads({ id: ticket.fileId }).verify.post())
    } catch (thrown) {
      // `missing`: the object is not there yet; one more `PUT` of the same file, then verify again (DOC-55 §12).
      const failure = apiErrorOf(thrown)
      const first = (failure.details as { code?: string }[] | undefined)?.[0]?.code
      if (attempt === 0 && failure.code === 'file_not_verified' && first === 'missing') continue
      throw thrown
    }
    return { fileId: ticket.fileId }
  }
}
