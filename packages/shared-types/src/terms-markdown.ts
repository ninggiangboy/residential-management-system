/**
 * The Markdown subset of the terms of use and the privacy notice (DOC-36 §8, DR-126). One pure function: the API validates with
 * it, the web CMS previews with it, and the web and native apps render its blocks, so no client needs a Markdown library or
 * injects HTML.
 *
 * Allowed: headings `##` and `###` (no `#`), paragraphs, bullet and numbered lists (two levels), `**bold**`, `*italic*`, line
 * breaks, and links `[text](https://…)`. Refused: HTML, images, tables, code, `http`, `javascript:` and relative links, and a text
 * over 100 KB.
 */
export const TERMS_MAX_BYTES = 100 * 1024

export type TermsInline =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: TermsInline[] }
  | { type: 'italic'; children: TermsInline[] }
  | { type: 'link'; text: string; href: string }
  | { type: 'break' }

export interface TermsListItem {
  inline: TermsInline[]
  /** A second level only; a third is refused. */
  children: TermsListItem[]
}

export type TermsBlock =
  | { type: 'heading'; level: 2 | 3; inline: TermsInline[] }
  | { type: 'paragraph'; inline: TermsInline[] }
  | { type: 'list'; ordered: boolean; items: TermsListItem[] }

/** The first violation: its 1-based line and a rule code. The API answers 400 `validation_failed` with `path = "text.vi:<line>"`. */
export interface TermsError {
  line: number
  rule:
    | 'empty'
    | 'too_large'
    | 'heading_level'
    | 'html'
    | 'image'
    | 'code'
    | 'table'
    | 'link'
    | 'indent'
}

export const isTermsError = (value: TermsBlock[] | TermsError): value is TermsError =>
  !Array.isArray(value)

const LIST_ITEM = /^( *)([-*]|\d{1,3}\.) +(\S.*)$/
const HEADING = /^(#{1,6})(?: +(.*))?$/
const LINK = /\[([^\]\n]*)\]\(([^)\n]*)\)/g

/** The rule a line breaks, if any, before it is turned into inline nodes. */
function lineProblem(line: string): TermsError['rule'] | null {
  if (/<[A-Za-z/!?]/.test(line)) return 'html'
  if (/!\[/.test(line)) return 'image'
  if (line.includes('`')) return 'code'
  if (line.trimStart().startsWith('|')) return 'table'
  for (const match of line.matchAll(LINK)) {
    const href = match[2] ?? ''
    try {
      if (new URL(href).protocol !== 'https:') return 'link'
    } catch {
      return 'link'
    }
  }
  return null
}

/** `**bold**`, `*italic*` and `[text](https://…)`; an unmatched marker stays literal text. */
function inlineOf(text: string): TermsInline[] {
  const out: TermsInline[] = []
  let rest = text
  let plain = ''
  const flush = () => {
    if (plain) out.push({ type: 'text', text: plain })
    plain = ''
  }
  while (rest.length > 0) {
    const link = /^\[([^\]\n]*)\]\(([^)\n]*)\)/.exec(rest)
    if (link) {
      flush()
      out.push({ type: 'link', text: link[1] ?? '', href: link[2] ?? '' })
      rest = rest.slice(link[0].length)
      continue
    }
    const bold = /^\*\*(.+?)\*\*/.exec(rest)
    if (bold) {
      flush()
      out.push({ type: 'bold', children: inlineOf(bold[1] ?? '') })
      rest = rest.slice(bold[0].length)
      continue
    }
    const italic = /^\*([^*\s](?:[^*]*[^*\s])?)\*/.exec(rest)
    if (italic) {
      flush()
      out.push({ type: 'italic', children: inlineOf(italic[1] ?? '') })
      rest = rest.slice(italic[0].length)
      continue
    }
    plain += rest[0]
    rest = rest.slice(1)
  }
  flush()
  return out
}

/** Lines of one paragraph, joined by a visible break so each line the author typed stays a line. */
function paragraphInline(lines: string[]): TermsInline[] {
  return lines.flatMap((line, i) => [
    ...(i > 0 ? [{ type: 'break' } as const] : []),
    ...inlineOf(line.trim()),
  ])
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one pass over the lines with the block state; a split would pass that state around without making a rule clearer
export function parseTermsMarkdown(text: string): TermsBlock[] | TermsError {
  if (text.trim() === '') return { line: 1, rule: 'empty' }
  if (new TextEncoder().encode(text).length > TERMS_MAX_BYTES) return { line: 1, rule: 'too_large' }

  const blocks: TermsBlock[] = []
  let paragraph: string[] = []
  let list: Extract<TermsBlock, { type: 'list' }> | null = null
  const closeParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', inline: paragraphInline(paragraph) })
    paragraph = []
  }
  const closeList = () => {
    if (list) blocks.push(list)
    list = null
  }

  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (const [index, raw] of lines.entries()) {
    const line = index + 1
    const problem = lineProblem(raw)
    if (problem) return { line, rule: problem }
    if (raw.trim() === '') {
      closeParagraph()
      closeList()
      continue
    }

    const heading = HEADING.exec(raw)
    if (heading) {
      const level = heading[1]?.length ?? 0
      if (level !== 2 && level !== 3) return { line, rule: 'heading_level' }
      closeParagraph()
      closeList()
      blocks.push({ type: 'heading', level, inline: inlineOf((heading[2] ?? '').trim()) })
      continue
    }

    const item = LIST_ITEM.exec(raw)
    if (item) {
      closeParagraph()
      const indent = item[1]?.length ?? 0
      const ordered = /\d/.test(item[2] ?? '')
      const entry: TermsListItem = { inline: inlineOf((item[3] ?? '').trim()), children: [] }
      if (indent >= 6) return { line, rule: 'indent' }
      if (indent >= 2) {
        const parent = list?.items.at(-1)
        if (!parent) return { line, rule: 'indent' }
        parent.children.push(entry)
      } else {
        if (list && list.ordered !== ordered) closeList()
        list ??= { type: 'list', ordered, items: [] }
        list.items.push(entry)
      }
      continue
    }

    if (/^ {4,}|^\t/.test(raw)) return { line, rule: 'code' }
    closeList()
    paragraph.push(raw)
  }
  closeParagraph()
  closeList()
  return blocks
}
