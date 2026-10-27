/** The `error.code` of each failed request, written by whoever answers it and read by the request line (`code`). */
export const errorCodes = new WeakMap<Request, string>()

/** The `details.scope` of a 429 `rate_limited` answer (the bucket family), read by the request line for `rate_limited_total`. */
export const errorScopes = new WeakMap<Request, string>()
