import type { Log } from '@core/kernel'
import { ConsoleMailer, type Mailer, SmtpMailer } from '@core/mail'
import type { Config } from './config'

/**
 * Sends only to the addresses of `MAIL_ALLOWLIST` and logs `not_allowlisted` for any other, returning normally (DOC-26 §5.5): the
 * `staging` driver, so a test environment never mails a real person by accident.
 */
class AllowlistMailer implements Mailer {
  private readonly allowed: ReadonlySet<string>

  constructor(
    private readonly inner: Mailer,
    allowed: readonly string[],
    private readonly log: Log,
  ) {
    this.allowed = new Set(allowed.map((address) => address.toLowerCase()))
  }

  async send(mail: Parameters<Mailer['send']>[0]): Promise<void> {
    if (!this.allowed.has(mail.to.toLowerCase())) {
      this.log.warn(
        { event: 'auth.mail', outcome: 'not_allowlisted' },
        'mail not sent (not on MAIL_ALLOWLIST)',
      )
      return
    }
    await this.inner.send(mail)
  }
}

/** The mailer `MAIL_DRIVER` asks for: `console` logs, `smtp` sends (Mailpit locally), `allowlist` is `smtp` for the listed addresses. */
export function createMailerFor(config: Config, log: Log): Mailer {
  const { drivers, secrets } = config
  if (drivers.MAIL_DRIVER === 'console') return new ConsoleMailer(log, { printLinks: true })
  const smtp = new SmtpMailer(
    {
      host: drivers.SMTP_HOST ?? 'localhost',
      port: drivers.SMTP_PORT,
      requireTls: drivers.SMTP_PORT === 587,
      user: drivers.SMTP_USER,
      password: secrets.SMTP_PASSWORD,
    },
    drivers.MAIL_FROM ?? 'RMS <no-reply@localhost>',
  )
  return drivers.MAIL_DRIVER === 'allowlist'
    ? new AllowlistMailer(smtp, drivers.MAIL_ALLOWLIST, log)
    : smtp
}
