import { authenticatedFetch } from '../api/client'
import { env } from '../env'
import { languageStore } from './i18n'

/** A file the API answers with bytes (a PDF, DOC-34 §8): fetched with the bearer token, then saved; a link would not carry the token. */
export class FileDownloadError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number | undefined,
  ) {
    super(`download ${status}`)
  }
}

/** Fetches `path` (under the API base, such as `/staff/charges/<id>/pdf?language=vi`). A 503 carries `Retry-After` (the renderer is busy). */
export async function fetchFile(
  path: string,
  fallbackName: string,
): Promise<{ blob: Blob; name: string }> {
  const response = await authenticatedFetch(`${env.apiBaseUrl}${path}`, {
    headers: { 'accept-language': languageStore.get() },
  })
  if (!response.ok) {
    const retry = Number(response.headers.get('retry-after'))
    throw new FileDownloadError(
      response.status,
      Number.isFinite(retry) && retry > 0 ? retry : undefined,
    )
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1]
  return { blob: await response.blob(), name: name ?? fallbackName }
}

/** Saves a blob under a name (a temporary link, clicked and removed). */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const { blob, name } = await fetchFile(path, fallbackName)
  saveBlob(blob, name)
}
