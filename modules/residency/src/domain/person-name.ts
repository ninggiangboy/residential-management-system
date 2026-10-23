import { ValidationError } from '@core/kernel'
import { parseName } from './import/row-rules'

/** A person's name as the forms take it (DQ-17): spaces collapsed, 2 to 100 characters, a letter, no control character. */
export function personNameOf(input: string, path = 'fullName'): string {
  const name = parseName(input)
  if (name === null)
    throw new ValidationError([
      { path, code: 'format', message: '2 to 100 characters with a letter' },
    ])
  return name
}
