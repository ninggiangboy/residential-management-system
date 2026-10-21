/** The `error.code` of each failed request, written by whoever answers it and read by the request line (`code`). */
export const errorCodes = new WeakMap<Request, string>()
