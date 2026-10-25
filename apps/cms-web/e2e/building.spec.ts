import { expect, test } from '@playwright/test'
import { signInAndWait } from './support/app'

test.describe('W-Building (UIWS-17…23)', () => {
  test('a Manager gets the Forbidden state by URL and the sidebar has no entry (UIWS-20)', async ({
    page,
  }) => {
    await signInAndWait(page, 'manager')
    await expect(page.getByRole('link', { name: 'Tòa nhà và cấu hình' })).toHaveCount(0)
    await page.goto('/building')
    await expect(page.getByText('Bạn không có quyền xem nội dung này')).toBeVisible()
  })

  test('only the changed fields are sent and the form resets to the answer (UIWS-17)', async ({
    page,
  }) => {
    await signInAndWait(page, 'admin')
    await page.goto('/building')
    await expect(page.getByLabel('Hotline')).toHaveValue('1900 1234')
    const bodies: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'PATCH' && request.url().endsWith('/staff/settings'))
        bodies.push(request.postData() ?? '')
    })
    await page.getByLabel('Hotline').fill('1900 5678')
    await page.getByLabel(/Hạn thanh toán mặc định/).fill('15')
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(page.getByText('Đã lưu cấu hình')).toBeVisible()
    expect(JSON.parse(bodies[0] ?? '{}')).toEqual({
      building: { hotline: '1900 5678' },
      settings: { defaultDueDays: 15 },
    })
    await page.reload()
    await expect(page.getByLabel('Hotline')).toHaveValue('1900 5678')
    await expect(page.getByLabel(/Hạn thanh toán mặc định/)).toHaveValue('15')
  })

  test('an out-of-range setting shows its message under the field and saves nothing (UIWS-18)', async ({
    page,
  }) => {
    await signInAndWait(page, 'admin')
    await page.goto('/building')
    await page.getByLabel(/Hạn thanh toán mặc định/).fill('0')
    await page.getByLabel(/Khóa đăng nhập trong/).fill('4')
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(page.getByLabel(/Hạn thanh toán mặc định/)).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByLabel(/Khóa đăng nhập trong/)).toHaveAttribute('aria-invalid', 'true')
  })

  test('leaving with unsaved edits asks first (UIWS-23)', async ({ page }) => {
    await signInAndWait(page, 'admin')
    await page.goto('/building')
    await page.getByLabel('Hotline').fill('1900 0000')
    await page.getByRole('link', { name: 'Nhân viên' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Bỏ thay đổi chưa lưu?' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Hủy' }).click()
    await expect(page).toHaveURL(/\/building/)
    await page.getByRole('link', { name: 'Nhân viên' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Bỏ thay đổi' }).click()
    await expect(page).toHaveURL(/\/staff/)
  })

  test('a terms text with HTML is refused before any request and a valid one publishes (UIWS-22)', async ({
    page,
  }) => {
    await signInAndWait(page, 'admin')
    await page.goto('/building')
    await page.getByRole('button', { name: 'Xuất bản phiên bản mới' }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Tiếng Việt').fill('## Điều khoản\n\nXin chào <b>bạn</b>')
    await expect(dialog.getByRole('button', { name: 'Xuất bản' })).toBeDisabled()
    await dialog.getByLabel('Tiếng Việt').fill('## Điều khoản\n\nDùng đúng mục đích.')
    await dialog.getByLabel('English').fill('## Terms\n\nUse it as intended.')
    await dialog.getByRole('button', { name: 'Xuất bản' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Xuất bản' }).click()
    await expect(page.getByText(/Đã xuất bản phiên bản \d+/)).toBeVisible()
  })
})
