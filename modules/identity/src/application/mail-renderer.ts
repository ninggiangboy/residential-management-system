import { createTranslator, type MessageKey } from '@rms/i18n-catalog'
import type { Language } from '@rms/shared-types'
import type { MailKind } from '../contracts'

export interface RenderedMail {
  subject: string
  text: string
  html: string
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The text as HTML: escaped, links made clickable, a blank line a new paragraph. */
const toHtml = (text: string): string =>
  text
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p>${escapeHtml(paragraph).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`)}</p>`,
    )
    .join('\n')

/**
 * Renders a staff mail from the catalog in the staff member's language (DOC-26 §5.4, DR-71). `params` are the non-secret
 * parameters of the command, `values` the ones the handler adds (the name, the link or the code).
 */
export function renderMail(
  kind: MailKind,
  language: Language,
  values: Record<string, string | number>,
): RenderedMail {
  const t = createTranslator(language)
  const subject = t(`mail.${kind}.subject` as MessageKey)
  const text = t(`mail.${kind}.body` as MessageKey, values)
  return { subject, text, html: toHtml(text) }
}

/** The label of a step-up action in the staff member's language. */
export const actionLabel = (action: string, language: Language): string =>
  createTranslator(language)(`mail.action.${action}` as MessageKey)
