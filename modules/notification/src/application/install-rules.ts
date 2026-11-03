import { CATALOGS } from '@rms/i18n-catalog'
import { NOTIFICATION_TEMPLATES, TEMPLATE_KEYS } from '@rms/shared-types'
import type { NotificationIntegration } from '../contracts'

/**
 * The boot check of `installNotification` (DOC-31 §2.2, §11, NT-03, DOC-12 §4.4): a rule that names a key outside the catalog
 * (`staff.invited` is not one, DR-116), two rules with one handler name, a rule without an event, or a template without a `vi`
 * and an `en` text fails the boot and names the offender. Every key the producers ship must have its texts, and the whole
 * catalog is checked, not only the keys in use, so a missing text is found on the first start.
 */
export function assertIntegrations(integrations: readonly NotificationIntegration[]): void {
  const handlers = new Set<string>()
  for (const integration of integrations)
    for (const rule of integration.rules) {
      if (rule.event.trim() === '')
        throw new Error(`notification: a rule of ${integration.producer} names no event`)
      if (handlers.has(rule.handler))
        throw new Error(`notification: two rules share the handler name ${rule.handler}`)
      handlers.add(rule.handler)
    }
  for (const key of TEMPLATE_KEYS) {
    if (!(key in NOTIFICATION_TEMPLATES))
      throw new Error(`notification: template ${key} is not in the catalog`)
    for (const language of ['vi', 'en'] as const)
      for (const part of ['title', 'body'] as const)
        if (!(CATALOGS[language] as Record<string, string>)[`notify.${key}.${part}`])
          throw new Error(`notification: template ${key} has no ${language} ${part}`)
  }
}

/** The key a rule's plans may use is checked when they are built (NT-03): `staff.invited` or an unknown key never reaches a row. */
export function assertTemplateKey(key: string): void {
  if (!(key in NOTIFICATION_TEMPLATES))
    throw new Error(`notification: template ${key} is not in the catalog`)
}
