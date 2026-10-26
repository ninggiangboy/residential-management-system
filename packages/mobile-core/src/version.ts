/** `x.y.z` compared as numbers; a part that is missing or not a number counts as 0. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split('.').map((p) => Number.parseInt(p, 10) || 0)
  const left = parts(a)
  const right = parts(b)
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return Math.sign(diff)
  }
  return 0
}

/** The early check of DOC-55 §16: the installed version is below `apps.<app>.minVersion` of `GET /public/config` (UIRA-07). */
export const isBelowMinimum = (installed: string, minimum: string | undefined | null): boolean =>
  !!minimum && compareVersions(installed, minimum) < 0
