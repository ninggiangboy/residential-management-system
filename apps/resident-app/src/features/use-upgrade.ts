import { useUpgradeRequired } from '@rms/mobile-core'
import { useConfig } from '../api/hooks'

/** The early check against E-03 and the late one from a 426 (DOC-55 §16, UIRA-07). `null` when the app is current. */
export function useUpgradeCheck() {
  const config = useConfig()
  return useUpgradeRequired(config.data?.apps.resident)
}
