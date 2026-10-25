import { type ApiError, ApiException, apiErrorFromBody, networkError } from '@rms/client-core'

interface Answer {
  data: unknown
  error: { status: unknown; value: unknown } | null
  response: Response
}

/** What Eden Treaty returns for an answer; a failure becomes the `ApiException` that `parseApiError` would have made. */
function failureOf(answer: Pick<Answer, 'error' | 'response'>): ApiError | null {
  const { error, response } = answer
  if (!error) return null
  const retryAfter = Number(response.headers.get('retry-after'))
  return apiErrorFromBody(Number(error.status), error.value, {
    requestId: response.headers.get('x-request-id') ?? '',
    retryAfter:
      Number.isFinite(retryAfter) && response.headers.has('retry-after') ? retryAfter : undefined,
    replayed: response.headers.get('idempotent-replayed') === 'true',
  })
}

/** The data of a successful answer; any other answer throws (queries and mutations catch it as `error`). */
export function unwrap<R extends Answer>(answer: R): NonNullable<R['data']> {
  const failure = failureOf(answer)
  if (failure) throw new ApiException(failure)
  return answer.data as NonNullable<R['data']>
}

/** For an answer with no body (204). */
export function unwrapEmpty(answer: Answer): void {
  const failure = failureOf(answer)
  if (failure) throw new ApiException(failure)
}

/** Any thrown value as an `ApiError`: a screen shows `errorText(t, apiErrorOf(error))`. */
export function apiErrorOf(thrown: unknown): ApiError {
  if (thrown instanceof ApiException) return thrown.error
  return networkError('', thrown instanceof Error ? thrown.message : undefined)
}

export const ifMatch = (version: number | string) => ({ 'if-match': `"${version}"` })
