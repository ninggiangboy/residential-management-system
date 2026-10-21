/**
 * The container health check (DOC-70 §6): `GET /health/ready` on the ops port. Exit 0 when it answers 200, 1 otherwise, so
 * Docker marks the container `healthy` only when the database answers and the process is not stopping.
 */
const port = process.env.OPS_PORT ?? '3001'
const response = await fetch(`http://127.0.0.1:${port}/health/ready`, {
  signal: AbortSignal.timeout(3000),
}).catch(() => null)
process.exit(response?.status === 200 ? 0 : 1)
