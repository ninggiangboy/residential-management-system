import { expect, type Page } from '@playwright/test'
import { PASSWORD, STAFF } from './seed'

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3100/api/v1'
const MAIL_URL = process.env.E2E_MAIL_URL ?? 'http://localhost:8025'

export type Who = keyof typeof STAFF

/** Signs in through the form, as a person does; lands on the page the role lands on. */
export async function signIn(page: Page, who: Who, password = PASSWORD): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(STAFF[who].email)
  await page.getByLabel('Mật khẩu').fill(password)
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
}

export async function signInAndWait(page: Page, who: Who): Promise<void> {
  await signIn(page, who)
  await expect(page).toHaveURL(/\/(units|wrong-app)/)
}

interface MailMessage {
  ID: string
  Created: string
  To: { Address: string }[]
  Subject: string
}

/**
 * The newest message for `to` that arrived at or after `since` (`Date.now()` taken before the action that sends it), polled for up
 * to 20 s: the outbox relay sends mail within a second or two, and the same address gets many mails in one run.
 */
export async function mailTo(
  to: string,
  matching?: RegExp,
  since = 0,
): Promise<{ subject: string; text: string }> {
  const until = Date.now() + 20_000
  for (;;) {
    const list = (await (
      await fetch(`${MAIL_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
    ).json()) as {
      messages?: MailMessage[]
    }
    for (const message of list.messages ?? []) {
      if (Date.parse(message.Created) < since) continue
      const detail = (await (await fetch(`${MAIL_URL}/api/v1/message/${message.ID}`)).json()) as {
        Text: string
        Subject: string
      }
      if (!matching || matching.test(detail.Text))
        return { subject: detail.Subject, text: detail.Text }
    }
    if (Date.now() > until)
      throw new Error(`no mail for ${to}${matching ? ` matching ${matching}` : ''}`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

export const linkIn = (text: string): string => {
  const match = /https?:\/\/[^\s)>"]+/.exec(text)
  if (!match) throw new Error('no link in the mail')
  return match[0]
}

export const unique = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
