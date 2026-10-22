import { createPublicKey } from 'node:crypto'
import type { Clock } from '@core/kernel'
import { STAFF_ROLES, type StaffRole } from '@rms/shared-types'
import { type CryptoKey, importJWK, importPKCS8, jwtVerify, SignJWT } from 'jose'
import type { TokenSigner } from '../../application/ports'
import type { AccessClaims, AccessTokenVerifier } from '../../contracts'
import { UnauthenticatedError } from '../../domain/errors'

const ALG = 'ES256'
const ISSUER = 'rms'
const TYPE = 'at+jwt'
/** DOC-26 §3.1: `exp` is checked with a tolerance of 5 seconds. */
const TOLERANCE_SECONDS = 5

interface KeyPair {
  kid: string
  signing: CryptoKey
  verifying: CryptoKey
}

/** The highest `k<n>` signs (`k10` > `k9`); every id verifies (DOC-26 §3.2). */
const byNumber = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1))

export interface JoseTokensOptions {
  /** `JWT_KEYS`: `kid → PEM` of an ES256 (P-256) private key. */
  keys: Readonly<Record<string, string>>
  accessTtlSeconds: number
  clock: Clock
}

/**
 * ES256 access tokens with a key ring (DOC-26 §3.1, §3.2, ADR-0011). The public half of each key is derived from its private PEM,
 * so one secret per `kid` is enough. The ring is imported on first use (and `ready()` lets a boot check force it), so the
 * module installs synchronously. Verification accepts only `alg = ES256`, `typ = at+jwt` and `iss = rms`, reads the `kid`, and
 * refuses an unknown one; every failure is a 401 `unauthenticated`.
 */
export class JoseTokens implements TokenSigner, AccessTokenVerifier {
  private readonly ring: Promise<{ pairs: ReadonlyMap<string, KeyPair>; newest: KeyPair }>

  constructor(private readonly options: JoseTokensOptions) {
    this.ring = this.load()
    // A bad ring rejects every use; this only keeps the rejection from being reported twice at start-up.
    this.ring.catch(() => undefined)
  }

  /** Resolves when every key of the ring is imported; rejects when one is not a valid ES256 private key. */
  async ready(): Promise<void> {
    await this.ring
  }

  private async load() {
    const { keys } = this.options
    const kids = Object.keys(keys).sort(byNumber)
    const newestKid = kids.at(-1)
    if (!newestKid) throw new Error('JWT_KEYS holds no key')
    const pairs = new Map<string, KeyPair>()
    for (const kid of kids) {
      const pem = keys[kid] as string
      const jwk = createPublicKey(pem).export({ format: 'jwk' })
      pairs.set(kid, {
        kid,
        signing: await importPKCS8(pem, ALG),
        verifying: (await importJWK(jwk, ALG)) as CryptoKey,
      })
    }
    return { pairs, newest: pairs.get(newestKid) as KeyPair }
  }

  async signAccess(claims: AccessClaims): Promise<{ token: string; expiresIn: number }> {
    const { accessTtlSeconds, clock } = this.options
    const { newest } = await this.ring
    const issuedAt = Math.floor(clock.now().getTime() / 1000)
    const { sub, ...rest } = claims
    const token = await new SignJWT({ ...rest })
      .setProtectedHeader({ alg: ALG, typ: TYPE, kid: newest.kid })
      .setIssuer(ISSUER)
      .setSubject(sub)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + accessTtlSeconds)
      .sign(newest.signing)
    return { token, expiresIn: accessTtlSeconds }
  }

  async verify(token: string): Promise<AccessClaims> {
    try {
      const { pairs } = await this.ring
      const { payload } = await jwtVerify(
        token,
        async (header) => {
          const pair = header.kid === undefined ? undefined : pairs.get(header.kid)
          if (!pair) throw new Error('unknown kid')
          return pair.verifying
        },
        {
          algorithms: [ALG],
          issuer: ISSUER,
          typ: TYPE,
          clockTolerance: TOLERANCE_SECONDS,
          currentDate: this.options.clock.now(),
        },
      )
      return toClaims(payload)
    } catch {
      throw new UnauthenticatedError()
    }
  }
}

function toClaims(payload: Record<string, unknown>): AccessClaims {
  const { sub, kind, sid } = payload
  if (typeof sub !== 'string' || typeof sid !== 'string') throw new Error('malformed claims')
  if (kind === 'resident') return { sub, kind, sid }
  const { role, bid } = payload
  if (kind !== 'staff' || typeof bid !== 'string' || !STAFF_ROLES.includes(role as StaffRole))
    throw new Error('malformed claims')
  return { sub, kind, role: role as StaffRole, bid, sid }
}
