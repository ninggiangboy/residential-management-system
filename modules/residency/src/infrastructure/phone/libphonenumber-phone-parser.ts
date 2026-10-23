import { parsePhoneNumberFromString } from 'libphonenumber-js/max'
import type { PhoneParser } from '../../domain/import/row-rules'

/**
 * The phone rule of DQ-18 and DQ-19 (DR-114): the `max` metadata, region VN for a national number, valid somewhere in the
 * world. The default `min` bundle accepts `0123456789`, which the `max` one refuses.
 */
export class LibphonenumberPhoneParser implements PhoneParser {
  parse(input: string): { e164: string; landline: boolean } | null {
    const parsed = parsePhoneNumberFromString(input, 'VN')
    if (!parsed?.isValid()) return null
    return { e164: parsed.number, landline: parsed.getType() === 'FIXED_LINE' }
  }
}
