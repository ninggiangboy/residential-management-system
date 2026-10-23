/** SQLSTATE 23505, as the driver reports it (directly or as the `cause` of a wrapped error). */
export const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { code?: string }).code === '23505' ||
    (error as { cause?: { code?: string } }).cause?.code === '23505')
