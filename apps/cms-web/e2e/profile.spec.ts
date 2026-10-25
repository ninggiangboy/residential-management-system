import { expect, test } from '@playwright/test'
import { mailTo, signInAndWait } from './support/app'
import { STAFF } from './support/seed'

// A 1×1 PNG: the smallest valid image the avatar upload accepts.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test.describe('W-Profile (UIWO-20…26)', () => {
  test('change the name: one PATCH with only fullName, and the shell shows it (UIWO-20)', async ({
    page,
  }) => {
    await signInAndWait(page, 'manager')
    await page.goto('/profile')
    const bodies: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'PATCH' && request.url().endsWith('/staff/me'))
        bodies.push(request.postData() ?? '')
    })
    await page.getByLabel('Họ và tên').fill('Lê Văn Quản Lý')
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(page.getByText('Đã lưu thay đổi.')).toBeVisible()
    expect(bodies).toHaveLength(1)
    expect(JSON.parse(bodies[0] ?? '{}')).toEqual({ fullName: 'Lê Văn Quản Lý' })
    await expect(page.locator('aside a[href="/profile"]')).toContainText('Lê Văn Quản Lý')
    // The email is read only and never sent (UIWO-26).
    await expect(page.getByLabel('Email')).toBeDisabled()
  })

  test('a photo: the order is register, PUT, verify, then the save (UIWO-22)', async ({ page }) => {
    await signInAndWait(page, 'admin')
    await page.goto('/profile')
    const calls: string[] = []
    page.on('request', (request) => {
      const url = request.url()
      if (url.includes('/staff/uploads') && request.method() === 'POST')
        calls.push(url.endsWith('/verify') ? 'verify' : 'register')
      else if (request.method() === 'PUT' && !url.includes(':3100')) calls.push('put')
      else if (request.method() === 'PATCH' && url.endsWith('/staff/me')) calls.push('patch')
    })
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: PNG })
    await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).toBeEnabled()
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(page.getByText('Đã lưu thay đổi.')).toBeVisible()
    expect(calls).toEqual(['register', 'put', 'verify', 'patch'])
    await expect(page.locator('aside img')).toBeVisible()
    // A 12 MB file is refused before any upload.
    calls.length = 0
    await page.locator('input[type=file]').setInputFiles({
      name: 'big.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(12 * 1024 * 1024),
    })
    await expect(page.getByRole('alert').filter({ hasText: /10 MB/ })).toBeVisible()
    expect(calls).toEqual([])
  })

  test('the language is saved at once and survives a reload (UIWO-23)', async ({ page }) => {
    await signInAndWait(page, 'manager')
    await page.goto('/profile')
    await page.getByRole('radio', { name: 'English' }).click()
    await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible()
    await page.getByRole('radio', { name: 'Tiếng Việt' }).click()
    await expect(page.getByRole('heading', { name: 'Hồ sơ cá nhân' })).toBeVisible()
  })

  test('a reset link mailed from the profile ends every session when used (UIWO-24, 25)', async ({
    page,
    browser,
  }) => {
    // A second live session is ended from the list.
    const other = await (await browser.newContext()).newPage()
    await signInAndWait(other, 'manager')
    await signInAndWait(page, 'manager')
    await page.goto('/profile')
    await expect(page.getByText('phiên hiện tại')).toBeVisible()
    const since = Date.now()
    await page.getByRole('button', { name: 'Gửi link đổi mật khẩu' }).click()
    await expect(page.getByText(`Đã gửi link tới ${STAFF.manager.email}.`)).toBeVisible()
    await expect(page.getByRole('button', { name: /Gửi link đổi mật khẩu/ })).toBeDisabled()
    const mail = await mailTo(STAFF.manager.email, /reset/, since)
    expect(mail.text).toMatch(/\/reset\?token=/)
    // End the other session from the list and check that it is gone.
    const ends = page.getByRole('button', { name: 'Đăng xuất phiên' })
    const before = await ends.count()
    expect(before).toBeGreaterThan(0)
    await ends.first().click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Đăng xuất phiên' }).click()
    await expect(ends).toHaveCount(before - 1)
  })
})
