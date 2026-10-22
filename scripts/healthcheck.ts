/**
 * Container healthcheck of the `rms-api` image (DOC-71 §6.1, DOC-70 §6): exits 0 only when `/health/ready` on the ops
 * port answers 200. The image has no `curl`, so Docker and Compose run this file.
 */
export {}

const port = process.env.OPS_PORT ?? '3001'

try {
  const res = await fetch(`http://localhost:${port}/health/ready`, {
    signal: AbortSignal.timeout(2500),
  })
  process.exit(res.status === 200 ? 0 : 1)
} catch {
  process.exit(1)
}
