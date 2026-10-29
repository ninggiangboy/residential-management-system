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

  test('opening a dialog with unsaved edits keeps the edits and asks nothing (UIWS-23)', async ({
    page,
  }) => {
    await signInAndWait(page, 'admin')
    await page.goto('/building')
    await page.getByLabel('Hotline').fill('1900 0000')
    await page.getByRole('button', { name: 'Xuất bản phiên bản mới' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await page.getByRole('dialog').getByRole('button', { name: 'Hủy' }).click()
    await expect(page.getByLabel('Hotline')).toHaveValue('1900 0000')
  })

  test('the second Admin to save sees the conflict and chooses (UIWS-19)', async ({
    browser,
    page,
  }) => {
    await signInAndWait(page, 'admin')
    await page.goto('/building')
    const other = await browser.newContext()
    const second = await other.newPage()
    await signInAndWait(second, 'admin')
    await second.goto('/building')
    await expect(second.getByLabel('Hotline')).toHaveValue(/\d/)

    // The first Admin saves a hotline and the email.
    await page.getByLabel('Hotline').fill('1900 1111')
    await page.getByLabel('Email', { exact: true }).fill('first@example.vn')
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(page.getByText('Đã lưu cấu hình')).toBeVisible()

    // The second Admin changed the hotline and the hours, and saves late: the banner names the hotline, both edits stay.
    await second.getByLabel('Hotline').fill('1900 2222')
    await second.getByLabel(/Hạn thanh toán mặc định/).fill('21')
    await second.getByRole('button', { name: 'Lưu thay đổi' }).click()
    const banner = second
      .getByRole('alert')
      .filter({ hasText: 'Có người vừa lưu cấu hình trước bạn' })
    await expect(banner).toContainText('Hai bên cùng sửa: Hotline')
    await expect(second.getByLabel('Hotline')).toHaveValue('1900 2222')
    await expect(second.getByLabel(/Hạn thanh toán mặc định/)).toHaveValue('21')
    await expect(second.getByLabel('Email', { exact: true })).toHaveValue('first@example.vn')

    // "Use the new version" drops the second Admin's edits.
    await banner.getByRole('button', { name: 'Dùng bản mới' }).click()
    await expect(banner).toHaveCount(0)
    await expect(second.getByLabel('Hotline')).toHaveValue('1900 1111')
    await expect(second.getByLabel(/Hạn thanh toán mặc định/)).not.toHaveValue('21')

    // Conflict again, and this time "Keep mine and save" writes the second Admin's fields over the first one's.
    await page.getByLabel('Hotline').fill('1900 3333')
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(page.getByText('Đã lưu cấu hình').last()).toBeVisible()
    await second.getByLabel('Hotline').fill('1900 4444')
    await second.getByRole('button', { name: 'Lưu thay đổi' }).click()
    await second.getByRole('button', { name: 'Giữ của tôi và lưu' }).click()
    await expect(second.getByText('Đã lưu cấu hình')).toBeVisible()
    await second.reload()
    await expect(second.getByLabel('Hotline')).toHaveValue('1900 4444')
    await other.close()
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
