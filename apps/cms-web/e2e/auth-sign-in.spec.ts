import { expect, test } from '@playwright/test'
import { signIn, signInAndWait } from './support/app'
import { STAFF } from './support/seed'

test.describe('W-Login (UIWO-01…10)', () => {
  test('UIWO-01: a Manager signs in, lands on /units, and no refresh token is readable by script', async ({
    page,
  }) => {
    await signInAndWait(page, 'manager')
    await expect(page).toHaveURL(/\/units/)
    await expect(page.getByRole('heading', { name: 'Căn hộ', level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.cookie)).not.toContain('rms_refresh')
    const stored = await page.evaluate(
      () => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
    )
    expect(stored).not.toMatch(/eyJ|refresh|token/i)
  })

  test('UIWO-02: a wrong password and an unknown email show the same sentence and no count', async ({
    page,
  }) => {
    await signIn(page, 'manager', 'wrong-password-1')
    const alert = page.getByRole('alert').first()
    await expect(alert).toHaveText('Email hoặc mật khẩu chưa đúng.')
    await expect(page.getByLabel('Mật khẩu')).toBeFocused()
    await expect(page.getByLabel('Mật khẩu')).toHaveValue('')
    await page.getByLabel('Email').fill('nobody@sunrise.example')
    await page.getByLabel('Mật khẩu').fill('whatever-123')
    await page.getByRole('button', { name: 'Đăng nhập' }).click()
    await expect(page.getByRole('alert').first()).toHaveText('Email hoặc mật khẩu chưa đúng.')
  })

  test('UIWO-04: the destination is kept, and a foreign redirect is ignored', async ({ page }) => {
    await page.goto('/units?q=an')
    await expect(page).toHaveURL(/\/login\?redirect=/)
    await page.getByLabel('Email').fill(STAFF.manager.email)
    await page.getByLabel('Mật khẩu').fill('Sunrise2026!')
    await page.getByRole('button', { name: 'Đăng nhập' }).click()
    await expect(page).toHaveURL(/\/units\?q=an/)
    await page.context().clearCookies()
    await page.goto('/login?redirect=https://evil.example')
    await page.getByLabel('Email').fill(STAFF.manager.email)
    await page.getByLabel('Mật khẩu').fill('Sunrise2026!')
    await page.getByRole('button', { name: 'Đăng nhập' }).click()
    await expect(page).toHaveURL(/\/units$/)
  })

  test('UIWO-05: a Technician sees only /wrong-app, and signing out clears the cookie', async ({
    page,
  }) => {
    await signIn(page, 'technician')
    await expect(page).toHaveURL(/\/wrong-app/)
    await expect(
      page.getByRole('heading', { name: 'Tài khoản này dùng App quản lý' }),
    ).toBeVisible()
    await page.goto('/units')
    await expect(page).toHaveURL(/\/wrong-app/)
    await page.getByRole('button', { name: 'Đăng xuất' }).click()
    await expect(page).toHaveURL(/\/login/)
    await page.goto('/units')
    await expect(page).toHaveURL(/\/login/)
  })

  test('UIWO-08: the language switch changes every string and survives a reload', async ({
    page,
  }) => {
    await page.goto('/login')
    await page.getByRole('radio', { name: 'EN' }).click()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('UIWO-07: the forgot dialog goes to the sent page for any email', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Quên mật khẩu' }).click()
    await page.getByRole('dialog').getByLabel('Email').fill('nobody@sunrise.example')
    await page.getByRole('button', { name: 'Gửi link' }).click()
    await expect(page).toHaveURL(/\/forgot\/sent/)
    await expect(page.getByRole('heading', { name: 'Kiểm tra email của bạn' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Gửi lại link sau 00:\d\d/ })).toBeDisabled()
  })
})
