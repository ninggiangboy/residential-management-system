import { DEFAULT_TIME_ZONE, zonedParts } from '@rms/shared-types'

export type GreetingKey =
  | 'common.greeting.morning'
  | 'common.greeting.noon'
  | 'common.greeting.afternoon'
  | 'common.greeting.evening'

/**
 * The greeting by the building-local hour (DR-200, UIRA-40): 05:00–10:59 morning, 11:00–12:59 midday, 13:00–17:59 afternoon,
 * 18:00–04:59 evening. The building zone is the product's one zone (DR-83) until the settings reach the app.
 */
export function greetingKey(now: Date, timeZone: string = DEFAULT_TIME_ZONE): GreetingKey {
  const { hour } = zonedParts(now, timeZone)
  if (hour >= 5 && hour < 11) return 'common.greeting.morning'
  if (hour >= 11 && hour < 13) return 'common.greeting.noon'
  if (hour >= 13 && hour < 18) return 'common.greeting.afternoon'
  return 'common.greeting.evening'
}
