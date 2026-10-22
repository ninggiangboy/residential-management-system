import { ValidationError } from '@core/kernel'
import { isTermsError, parseTermsMarkdown } from '@rms/shared-types'
import type { Bilingual, TermsKind } from '../contracts'

const KINDS: readonly TermsKind[] = ['terms', 'privacy']

/**
 * A version of the terms of use or the privacy notice that an Admin is about to publish (DOC-35 §9, DOC-36 §8). A published
 * version is write-once: the next number of the kind is taken by the repository, and the unique index decides a race.
 */
export class TermsVersion {
  private constructor(
    readonly kind: TermsKind,
    readonly text: Bilingual,
  ) {}

  /**
   * Both languages are required for a real building (the dossier supplies vi and en, P0-06); the demo building may publish vi
   * only. The text follows the restricted Markdown of `@rms/shared-types`.
   */
  static draft(
    input: { kind: TermsKind; text: Bilingual },
    building: { isDemo: boolean },
  ): TermsVersion {
    if (!KINDS.includes(input.kind))
      throw new ValidationError([{ path: 'kind', code: 'enum', message: 'terms or privacy' }])
    if (!building.isDemo && !input.text.en?.trim())
      throw new ValidationError([
        { path: 'text.en', code: 'required', message: 'both languages are required' },
      ])
    for (const language of ['vi', 'en'] as const) {
      const text = input.text[language]
      if (text === undefined) continue
      const parsed = parseTermsMarkdown(text)
      if (isTermsError(parsed))
        throw new ValidationError([
          { path: `text.${language}:${parsed.line}`, code: 'terms_text', message: parsed.rule },
        ])
    }
    return new TermsVersion(input.kind, input.text)
  }
}
