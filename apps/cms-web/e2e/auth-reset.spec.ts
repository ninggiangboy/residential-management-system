import { expect, test } from '@playwright/test'
import { linkIn, mailTo, signInAndWait, unique } from './support/app'
import { STAFF } from './support/seed'

test.describe('W-Forgot-Sent and W-Reset (UIWO-11…19)', () => {
  test('the reset rules, the used link and the new password (UIWO-15, 16, 17, 19)', async ({
    page,
    browser,
  }) => {
    // A fresh account, so the password of the shared ones stays as the other specs expect.
    await signInAndWait(page, 'admin')
    await page.goto('/staff/new')
    const email = `${unique('reset')}@sunrise.example`
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Họ và tên').fill('Đặt Lại Mật Khẩu')
    await dialog.getByLabel('Email công việc').fill(email)
    await dialog.getByRole('radio', { name: /^Bảo vệ/ }).click()
    const invitedAt = Date.now()
    await dialog.getByRole('button', { name: 'Tạo và gửi email' }).click()
    await expect(page.getByRole('row', { name: /Đặt Lại Mật Khẩu/ })).toBeVisible()
    const invite = linkIn((await mailTo(email, /invite/, invitedAt)).text)

    const guest = await (await browser.newContext()).newPage()
    await guest.goto(invite)
    const save = guest.getByRole('button', { name: 'Lưu mật khẩu mới' })
    const password = guest.getByLabel('Mật khẩu mới', { exact: true })
    const confirm = guest.getByLabel('Nhập lại mật khẩu mới')
    await expect(save).toBeDisabled()
    await password.fill('abcdefgh')
    await confirm.fill('abcdefgh')
    await expect(save).toBeDisabled()
    await expect(guest.getByText('Có cả chữ và số').locator('..')).toContainText('chưa đạt')
    await password.fill('abc12345')
    await confirm.fill('abc12346')
    await expect(save).toBeDisabled()
    await confirm.fill('abc12345')
    await expect(save).toBeEnabled()
    await save.click()
    await expect(guest).toHaveURL(/\/login\?reason=password_set/)

    // A reset link for the now active account: used once, the second use is invalid and offers a new link (UIWO-17).
    await guest.getByRole('button', { name: 'Quên mật khẩu' }).click()
    await guest.getByRole('dialog').getByLabel('Email').fill(email)
    const asked = Date.now()
    await guest.getByRole('button', { name: 'Gửi link' }).click()
    await expect(guest).toHaveURL(/\/forgot\/sent/)
    await expect(guest.getByText(`Nếu ${email} có tài khoản đang hoạt động`)).toBeVisible()
    const reset = linkIn((await mailTo(email, /reset/, asked)).text)
    const first = await (await browser.newContext()).newPage()
    await first.goto(reset)
    await first.getByLabel('Mật khẩu mới', { exact: true }).fill('newpass2026')
    await first.getByLabel('Nhập lại mật khẩu mới').fill('newpass2026')
    await first.getByRole('button', { name: 'Lưu mật khẩu mới' }).click()
    await expect(first).toHaveURL(/\/login\?reason=password_set/)
    await first.getByLabel('Email').fill(email)
    await first.getByLabel('Mật khẩu', { exact: true }).fill('newpass2026')
    await first.getByRole('button', { name: 'Đăng nhập' }).click()
    await expect(first).toHaveURL(/\/wrong-app/)

    const second = await (await browser.newContext()).newPage()
    await second.goto(reset)
    await second.getByLabel('Mật khẩu mới', { exact: true }).fill('another2026')
    await second.getByLabel('Nhập lại mật khẩu mới').fill('another2026')
    await second.getByRole('button', { name: 'Lưu mật khẩu mới' }).click()
    await expect(second.getByRole('heading', { name: 'Link không còn hiệu lực' })).toBeVisible()
    await second.getByRole('link', { name: 'Yêu cầu link mới' }).click()
    await expect(second).toHaveURL(/dialog=forgot/)
  })

  test('/reset with no token shows the invalid state and sends no request (UIWO-19)', async ({
    page,
  }) => {
    const requests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/auth/staff/password')) requests.push(request.url())
    })
    await page.goto('/reset')
    await expect(page.getByRole('heading', { name: 'Link không còn hiệu lực' })).toBeVisible()
    expect(requests).toEqual([])
  })

  test('the resend button counts down from 00:45 and the page needs router state (UIWO-12, 14)', async ({
    page,
  }) => {
    await page.goto('/forgot/sent')
    await expect(page).toHaveURL(/\/login\?dialog=forgot/)
    await page.getByRole('dialog').getByLabel('Email').fill(STAFF.manager.email)
    await page.getByRole('button', { name: 'Gửi link' }).click()
    const resend = page.getByRole('button', { name: /Gửi lại link sau/ })
    await expect(resend).toBeDisabled()
    await expect(resend).toContainText(/00:4\d/)
    // A reload keeps the browser's history state, so the page stays; a pasted link has none (UIWO-14).
    await page.reload()
    await expect(page).toHaveURL(/\/forgot\/sent/)
    const pasted = await page.context().newPage()
    await pasted.goto('/forgot/sent')
    await expect(pasted).toHaveURL(/\/login\?dialog=forgot/)
  })
})
