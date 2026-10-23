import { parsePhoneNumberFromString } from 'libphonenumber-js/max'
import type { PhoneNumbers } from '../../application/ports'

/**
 * A phone as the product stores it: E.164. Parsed with the `max` metadata, region VN, and valid somewhere in the world (DR-36,
 * DR-114): an overseas owner may have an account, and `0123456789` is refused, which the default `min` bundle would accept.
 */
export class LibphonenumberPhones implements PhoneNumbers {
  toE164(input: string): string | null {
    const parsed = parsePhoneNumberFromString(input, 'VN')
    return parsed?.isValid() ? parsed.number : null
  }
}
