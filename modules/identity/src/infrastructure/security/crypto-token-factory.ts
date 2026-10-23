import { hmacSha256Hex, randomDigits, randomToken, sha256Hex } from '@core/auth'
import type { TokenFactory } from '../../application/ports'

/** Random values and digests of DOC-26, over `@core/auth`. `hmacKey` is `OTP_HMAC_KEY` (DR-65). */
export class CryptoTokenFactory implements TokenFactory {
  constructor(private readonly hmacKey: string) {}

  opaque(): { token: string; hash: string } {
    const token = randomToken()
    return { token, hash: sha256Hex(token) }
  }

  hashOpaque(token: string): string {
    return sha256Hex(token)
  }

  digits(digits: number): string {
    return randomDigits(digits)
  }

  stepUpHmac(staffId: string, action: string, code: string): string {
    return hmacSha256Hex(this.hmacKey, `stepup:${staffId}:${action}:${code}`)
  }

  otpHmac(challengeId: string, code: string): string {
    return hmacSha256Hex(this.hmacKey, `otp:${challengeId}:${code}`)
  }
}
