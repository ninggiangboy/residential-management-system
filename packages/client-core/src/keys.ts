/**
 * Query keys come from these helpers and never from literals in screens (DOC-55 §7.2). The unit id is in the second position, so
 * data of unit A can never be read under unit B (CL-15).
 */
export const unitKey = (unitId: string, ...parts: readonly unknown[]) =>
  ['unit', unitId, ...parts] as const
export const staffKey = (...parts: readonly unknown[]) => ['staff', ...parts] as const
/** Not unit-specific: the account, its sessions, the public config. */
export const accountKey = (...parts: readonly unknown[]) => ['me', ...parts] as const
export const configKey = () => ['config'] as const
