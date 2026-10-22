import type { PasswordHasher } from '../../application/ports'

export interface Argon2Params {
  /** `ARGON2_MEMORY_KIB` (19456). */
  memoryKib: number
  /** `ARGON2_TIME_COST` (2). */
  timeCost: number
}

const STORED = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=\d+\$/

/**
 * Argon2id through `Bun.password` (DOC-26 §4.2, DR-39). The stored string is `$argon2id$v=19$m=19456,t=2,p=1$…`, from which
 * `needsRehash` reads `m` and `t`; a sign-in with older parameters stores a fresh hash. `dummyVerify` checks a password against a
 * hash made once with the same parameters, so an unknown email costs what a real check costs.
 */
export class Argon2PasswordHasher implements PasswordHasher {
  private dummy: Promise<string> | undefined

  constructor(private readonly params: Argon2Params) {}

  hash(plain: string): Promise<string> {
    return Bun.password.hash(plain, {
      algorithm: 'argon2id',
      memoryCost: this.params.memoryKib,
      timeCost: this.params.timeCost,
    })
  }

  verify(plain: string, hash: string): Promise<boolean> {
    return Bun.password.verify(plain, hash)
  }

  needsRehash(hash: string): boolean {
    const match = STORED.exec(hash)
    return (
      !match ||
      Number(match[1]) !== this.params.memoryKib ||
      Number(match[2]) !== this.params.timeCost
    )
  }

  async dummyVerify(plain: string): Promise<void> {
    this.dummy ??= this.hash('dummy-password-for-timing')
    await Bun.password.verify(plain, await this.dummy).catch(() => false)
  }
}
