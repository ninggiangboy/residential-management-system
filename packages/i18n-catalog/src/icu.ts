import { type MessageFormatElement, parse, TYPE } from '@formatjs/icu-messageformat-parser'

/**
 * The arguments of one ICU message, by name, with their kind: `plain` (`{name}`), `number` (`{n, number}` or a
 * `plural`), `date`, `time`, or `select:<options>`. A `plural` counts as a number, so `Còn {count} ngày` and
 * `{count, plural, one {# day left} other {# days left}}` take the same argument (DR-224).
 */
export function messageArguments(message: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  const add = (name: string, kind: string) =>
    found.set(name, (found.get(name) ?? new Set()).add(kind))
  const walk = (elements: MessageFormatElement[]) => {
    for (const el of elements) {
      switch (el.type) {
        case TYPE.argument:
          add(el.value, 'plain')
          break
        case TYPE.number:
          add(el.value, 'number')
          break
        case TYPE.date:
          add(el.value, 'date')
          break
        case TYPE.time:
          add(el.value, 'time')
          break
        case TYPE.select:
          add(el.value, `select:${Object.keys(el.options).sort().join(',')}`)
          for (const option of Object.values(el.options)) walk(option.value)
          break
        case TYPE.plural:
          add(el.value, 'number')
          for (const option of Object.values(el.options)) walk(option.value)
          break
        case TYPE.tag:
          walk(el.children)
          break
      }
    }
  }
  walk(parse(message))
  return found
}

/** Two languages agree on an argument when they give it the same kind; a plain argument also accepts a number. */
function sameKind(a: Set<string>, b: Set<string>): boolean {
  const pair = [kindOf(a), kindOf(b)].sort().join(' ')
  return pair === 'number plain' || kindOf(a) === kindOf(b)
}

/** The kind of an argument used several times in one message: its typed uses win over plain ones. */
const kindOf = (kinds: Set<string>) =>
  [...kinds]
    .filter((k) => k !== 'plain')
    .sort()
    .join('|') || 'plain'

const describe = (args: Map<string, Set<string>>) =>
  [...args].map(([name, kinds]) => `${name}:${[...kinds].sort().join('|')}`).join(', ') || 'none'

/**
 * What differs between two catalogs of the same keys (UICP-01): a key missing on one side, an empty message, a
 * message that does not parse, or a different set of argument names and kinds. Empty when the two are in step.
 */
export function compareCatalogs(
  base: Readonly<Record<string, string>>,
  other: Readonly<Record<string, string>>,
  names: { base: string; other: string },
): string[] {
  const problems: string[] = []
  for (const key of Object.keys(base))
    if (!Object.hasOwn(other, key)) problems.push(`${key}: missing in ${names.other}`)
  for (const key of Object.keys(other))
    if (!Object.hasOwn(base, key)) problems.push(`${key}: missing in ${names.base}`)
  for (const [key, message] of Object.entries(base)) {
    const translated = other[key]
    const problem =
      translated === undefined ? undefined : messageProblem(message, translated, names)
    if (problem) problems.push(`${key}: ${problem}`)
  }
  return problems
}

/** Why one message and its translation disagree, or `undefined` when they agree. */
function messageProblem(
  message: string,
  translated: string,
  names: { base: string; other: string },
): string | undefined {
  if (message.trim() === '' || translated.trim() === '') return 'empty message'
  let a: Map<string, Set<string>>
  let b: Map<string, Set<string>>
  try {
    a = messageArguments(message)
    b = messageArguments(translated)
  } catch (error) {
    return `not a valid ICU message (${(error as Error).message})`
  }
  const agree =
    a.size === b.size &&
    [...a].every(([name, kinds]) => b.has(name) && sameKind(kinds, b.get(name)!))
  return agree
    ? undefined
    : `arguments differ (${names.base}: ${describe(a)}; ${names.other}: ${describe(b)})`
}
