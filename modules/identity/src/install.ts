import type { ModuleHost } from '@core/runtime'
import { createIdentityModule, type IdentityDeps, type IdentityModule } from './identity.module'

/** The host narrowed to what `identity` needs (DOC-12 §4.2). */
export type IdentityHost = Pick<ModuleHost, 'logger' | 'clock' | 'ids' | 'database'> & IdentityDeps

export function installIdentity(host: IdentityHost): IdentityModule {
  return createIdentityModule({
    database: host.database,
    clock: host.clock,
    ids: host.ids,
    logger: host.logger,
    config: host.config,
    argon2: host.argon2,
    jwtKeys: host.jwtKeys,
    otpHmacKey: host.otpHmacKey,
    secretBox: host.secretBox,
    mailer: host.mailer,
    sms: host.sms,
    memberships: host.memberships,
    building: host.building,
    audited: host.audited,
    guards: host.guards,
    idempotent: host.idempotent,
    tickets: host.tickets,
    outboxMaxPayloadBytes: host.outboxMaxPayloadBytes,
    hasher: host.hasher,
    delay: host.delay,
  })
}
