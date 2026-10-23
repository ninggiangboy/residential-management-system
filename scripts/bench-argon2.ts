export {}

/**
 * Argon2id cost on the host it runs on (DOC-26 §4.2, DR-39, P1-10): `bun scripts/bench-argon2.ts [memoryKib] [timeCost]`.
 * Run it on the staging host and record the result in DR-39; raise `ARGON2_MEMORY_KIB` / `ARGON2_TIME_COST` if the host allows.
 */
const memoryCost = Number(process.argv[2] ?? 19456)
const timeCost = Number(process.argv[3] ?? 2)
const RUNS = 20
const PARALLEL = 8

const opts = { algorithm: 'argon2id', memoryCost, timeCost } as const
const hash = await Bun.password.hash('Sunrise2026!', opts)

const mean = async (fn: () => Promise<unknown>) => {
  const start = performance.now()
  for (let i = 0; i < RUNS; i++) await fn()
  return (performance.now() - start) / RUNS
}

const hashMs = await mean(() => Bun.password.hash('Sunrise2026!', opts))
const verifyMs = await mean(() => Bun.password.verify('Sunrise2026!', hash))
const start = performance.now()
await Promise.all(Array.from({ length: PARALLEL }, () => Bun.password.verify('Sunrise2026!', hash)))
const parallelMs = performance.now() - start

console.log(
  JSON.stringify({
    host: `${process.platform}/${process.arch}`,
    bun: Bun.version,
    memoryCost,
    timeCost,
    hashMs: Math.round(hashMs),
    verifyMs: Math.round(verifyMs),
    [`verify${PARALLEL}ParallelMs`]: Math.round(parallelMs),
  }),
)
