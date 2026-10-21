import { t } from 'elysia'

/** Matches `bodyOf()` in error-handler.plugin.ts — every error has this shape (DOC-42 §3). */
const errorShape = {
  error: t.Object({
    code: t.String({
      description: 'Stable error code, for clients to handle',
      examples: ['not_found'],
    }),
    message: t.String({ description: 'Human-readable message' }),
    details: t.Optional(
      t.Unknown({
        description:
          'validation_failed: a list of { path, code, message }; elsewhere an object whose keys the catalog lists (DOC-42 §5)',
      }),
    ),
  }),
}

const ERROR_DESCRIPTIONS = {
  400: 'Invalid data or business rule violation',
  401: 'Missing or invalid credentials',
  403: 'Not allowed (for example a recent confirmation is required)',
  404: 'Resource not found',
  409: 'Conflicts with the current state',
  429: 'Rate limit exceeded',
} as const

type ErrorStatus = keyof typeof ERROR_DESCRIPTIONS

/**
 * Declares the error responses of a route. `codes` lists the possible `error.code` values to show in the docs.
 * Note: errors returned by onError are not re-validated against this schema, so it only serves docs and client typing.
 */
export const errorResponse = (status: ErrorStatus, ...codes: string[]) =>
  t.Object(errorShape, {
    description: codes.length
      ? `${ERROR_DESCRIPTIONS[status]}. Error codes: ${codes.map((c) => `\`${c}\``).join(', ')}`
      : ERROR_DESCRIPTIONS[status],
  })

/** Schema validation errors (400) occur on every route that takes input, so they are bundled in and a route declares only its own. */
export const validationError = (...codes: string[]) =>
  errorResponse(400, 'validation_failed', ...codes)

export const BEARER_SCHEME = 'bearerAuth'

export const bearerSecurity = [{ [BEARER_SCHEME]: [] }]

/** The document the API serves; `tags` are the sections each module describes itself (`AppModule.docs`). */
export const openapiDocumentation = (tags: readonly { name: string; description: string }[]) => ({
  info: {
    title: 'Residential management API',
    version: '1.0.0',
    description:
      'One JSON-over-HTTPS API for the web CMS, the resident app and the staff app (DOC-50). The access token (JWT) is sent via ' +
      '`Authorization: Bearer`; the web CMS keeps its refresh token in an HttpOnly cookie.\n\n' +
      'Every error has the shape `{ "error": { "code", "message", "details?" } }`; `X-Request-Id` is on every answer.',
  },
  tags: [{ name: 'health', description: 'Service health checks' }, ...tags],
  components: {
    securitySchemes: {
      [BEARER_SCHEME]: {
        type: 'http' as const,
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'The 15-minute access token of `POST /auth/staff/login`, `POST /auth/otp/verify` or `POST /auth/refresh`',
      },
    },
  },
})
