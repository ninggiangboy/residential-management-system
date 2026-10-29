import { expect, type Page, test } from '@playwright/test'
import { linkIn, mailTo, signInAndWait, unique } from './support/app'
import { PASSWORD, STAFF } from './support/seed'

async function openCreate(page: Page) {
  await page.goto('/staff')
  await page.getByRole('link', { name: 'Tạo tài khoản' }).click()
  await expect(page.getByRole('dialog', { name: 'Tạo tài khoản nhân viên' })).toBeVisible()
}

async function fillCreate(page: Page, name: string, email: string, role: string) {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Họ và tên').fill(name)
  await dialog.getByLabel('Email công việc').fill(email)
  await dialog.getByRole('radio', { name: new RegExp(`^${role}`) }).click()
}

test.describe('W-Staff and W-Staff-New (UIWS-01…16)', () => {
  test('create a Guard as a Manager, set the password from the invitation and sign in (UIWS-10, 11)', async ({
    page,
    browser,
  }) => {
    await signInAndWait(page, 'manager')
    await openCreate(page)
    const dialog = page.getByRole('dialog')
    // The Manager's dialog offers only Technician and Guard (UIWS-10).
    await expect(dialog.getByRole('radio')).toHaveCount(2)
    await expect(dialog.getByRole('radio', { name: /^Kỹ thuật/ })).toBeVisible()
    await expect(dialog.getByRole('radio', { name: /^Bảo vệ/ })).toBeVisible()
    const email = `${unique('guard')}@sunrise.example`
    await fillCreate(page, 'Hoàng Đức Long', email, 'Bảo vệ')
    const since = Date.now()
    await dialog.getByRole('button', { name: 'Tạo và gửi email' }).click()
    await expect(
      page.getByText(`Đã tạo tài khoản. Email đặt mật khẩu đã gửi tới ${email}.`),
    ).toBeVisible()
    const row = page.getByRole('row', { name: /Hoàng Đức Long/ })
    await expect(row).toContainText('Bảo vệ')
    await expect(row).toContainText('Chờ đặt mật khẩu')

    // The invitation works once (UIWS-11, UIWO-18).
    const mail = await mailTo(email, /invite/, since)
    const link = linkIn(mail.text)
    const second = await (await browser.newContext()).newPage()
    await second.goto(link)
    await expect(second.getByRole('heading', { name: 'Đặt mật khẩu cho tài khoản' })).toBeVisible()
    await second.getByLabel('Mật khẩu mới', { exact: true }).fill('Guard2026pass')
    await second.getByLabel('Nhập lại mật khẩu mới').fill('Guard2026pass')
    await second.getByRole('button', { name: 'Lưu mật khẩu mới' }).click()
    await expect(second).toHaveURL(/\/login\?reason=password_set/)
    await expect(second.getByText('Đã đặt mật khẩu mới. Đăng nhập để tiếp tục.')).toBeVisible()
    await second.getByLabel('Email').fill(email)
    await second.getByLabel('Mật khẩu').fill('Guard2026pass')
    await second.getByRole('button', { name: 'Đăng nhập' }).click()
    await expect(second).toHaveURL(/\/wrong-app/)
    // The same link a second time: the page cannot know, E-07 answers, and the invite wording has no "ask for a new link" (UIWO-18).
    const again = await (await browser.newContext()).newPage()
    await again.goto(link)
    await again.getByLabel('Mật khẩu mới', { exact: true }).fill('Another2026pass')
    await again.getByLabel('Nhập lại mật khẩu mới').fill('Another2026pass')
    await again.getByRole('button', { name: 'Lưu mật khẩu mới' }).click()
    await expect(again.getByRole('heading', { name: 'Link không còn hiệu lực' })).toBeVisible()
    await expect(again.getByRole('link', { name: 'Yêu cầu link mới' })).toHaveCount(0)
  })

  test('an email in use is shown under the email field and the other values stay (UIWS-13)', async ({
    page,
  }) => {
    await signInAndWait(page, 'manager')
    await openCreate(page)
    await fillCreate(page, 'Trùng Email', STAFF.guard.email, 'Bảo vệ')
    await page.getByRole('dialog').getByRole('button', { name: 'Tạo và gửi email' }).click()
    await expect(
      page
        .getByRole('dialog')
        .getByText(/email|Email/)
        .filter({ hasText: 'đã' }),
    ).toBeVisible()
    await expect(page.getByRole('dialog').getByLabel('Họ và tên')).toHaveValue('Trùng Email')
  })

  test('a double click on the create button makes one account (UIWS-14)', async ({ page }) => {
    await signInAndWait(page, 'manager')
    await openCreate(page)
    const email = `${unique('tech')}@sunrise.example`
    await fillCreate(page, 'Nhấp Đúp', email, 'Kỹ thuật')
    await page.getByRole('dialog').getByRole('button', { name: 'Tạo và gửi email' }).dblclick()
    await expect(page.getByRole('row', { name: /Nhấp Đúp/ })).toHaveCount(1)
    await page.reload()
    await expect(page.getByRole('row', { name: /Nhấp Đúp/ })).toHaveCount(1)
  })

  test('a Manager sees actions only on Technician and Guard rows (UIWS-02)', async ({ page }) => {
    await signInAndWait(page, 'manager')
    await page.goto('/staff')
    await expect(page.getByRole('row', { name: new RegExp(STAFF.admin.name) })).toContainText(
      'Chỉ Admin quản lý',
    )
    await expect(page.getByRole('row', { name: new RegExp(STAFF.manager.name) })).toContainText(
      'Tài khoản của bạn',
    )
    await expect(
      page
        .getByRole('row', { name: new RegExp(STAFF.technician.name) })
        .getByRole('button', { name: 'Khóa' }),
    ).toBeVisible()
  })

  test('lock and unlock a Technician (UIWS-06)', async ({ page }) => {
    await signInAndWait(page, 'manager')
    await page.goto('/staff')
    const row = page.getByRole('row', { name: new RegExp(STAFF.technician.name) })
    // Each call answers after 600 ms, so the busy state is on screen long enough to look at (DOC-54 §17).
    await page.route(/\/staff\/accounts\/[^/]+\/(lock|unlock)$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600))
      await route.continue()
    })
    await row.getByRole('button', { name: 'Khóa' }).click()
    // Frame by frame: while the dialog leaves, its confirm button is still busy; it does not turn back to red first.
    await page.evaluate(() => {
      const w = window as unknown as { __exit: { busy: number; idle: number } }
      w.__exit = { busy: 0, idle: 0 }
      const start = performance.now()
      const tick = () => {
        const closing = document.querySelector('[role=alertdialog][data-state=closed]')
        if (closing) {
          if (closing.querySelector('button[aria-busy=true]')) w.__exit.busy++
          else w.__exit.idle++
        }
        if (performance.now() - start < 3000) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await page.getByRole('alertdialog').getByRole('button', { name: 'Khóa tài khoản' }).click()
    await expect(row).toContainText('Đã khóa')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    const exit = await page.evaluate(
      () => (window as unknown as { __exit: { busy: number; idle: number } }).__exit,
    )
    expect(exit.busy).toBeGreaterThan(0)
    expect(exit.idle).toBe(0)
    // Unlock has no dialog: its own button shows the call.
    const unlock = row.getByRole('button', { name: 'Mở khóa' })
    const before = await unlock.boundingBox()
    await unlock.click()
    await expect(unlock).toHaveAttribute('aria-busy', 'true')
    await expect(unlock.locator('.animate-spin')).toBeVisible()
    // The spinner sits over the label, so the button and the row around it keep their size.
    expect((await unlock.boundingBox())?.width).toBe(before?.width)
    await expect(row).toContainText('Đang hoạt động')
  })

  test('an Admin creates an Admin only after the step-up (UIWS-12, 24, 25, 28)', async ({
    page,
  }) => {
    await signInAndWait(page, 'admin')
    await openCreate(page)
    const email = `${unique('admin')}@sunrise.example`
    await fillCreate(page, 'Admin Mới', email, 'Admin')
    await page.getByRole('dialog').getByRole('button', { name: 'Tạo và gửi email' }).click()
    // The step-up dialog opens before any create call.
    const stepUp = page.getByRole('dialog', { name: 'Xác nhận thao tác nhạy cảm' })
    await expect(stepUp).toBeVisible()
    await expect(page.getByRole('row', { name: /Admin Mới/ })).toHaveCount(0)
    const since = Date.now()
    await stepUp.getByRole('button', { name: 'Gửi mã' }).click()
    const mail = await mailTo(STAFF.admin.email, /\b\d{6}\b/, since)
    const code = /\b(\d{6})\b/.exec(mail.text.replace(/https?:\S+/g, ''))?.[1] ?? ''
    expect(code).toHaveLength(6)
    // A wrong code keeps the dialog open and the form behind it.
    await stepUp.getByLabel('Mật khẩu').fill(PASSWORD)
    await stepUp.getByLabel('Mã xác nhận').fill(code === '000000' ? '111111' : '000000')
    await stepUp.getByRole('button', { name: 'Xác nhận' }).click()
    await expect(stepUp.getByText(/Mật khẩu hoặc mã chưa đúng/)).toBeVisible()
    await expect(stepUp).toBeVisible()
    // The right code finishes the request.
    await stepUp.getByLabel('Mã xác nhận').fill(code)
    await stepUp.getByRole('button', { name: 'Xác nhận' }).click()
    await expect(
      page.getByText(`Đã tạo tài khoản. Email đặt mật khẩu đã gửi tới ${email}.`),
    ).toBeVisible()
    await expect(page.getByRole('row', { name: /Admin Mới/ })).toHaveCount(1)
  })

  test('cancelling the step-up sends nothing and the form is editable again (UIWS-30)', async ({
    page,
  }) => {
    await signInAndWait(page, 'admin')
    await openCreate(page)
    await fillCreate(page, 'Không Tạo', `${unique('no')}@sunrise.example`, 'Admin')
    await page.getByRole('dialog').getByRole('button', { name: 'Tạo và gửi email' }).click()
    await page
      .getByRole('dialog', { name: 'Xác nhận thao tác nhạy cảm' })
      .getByRole('button', { name: 'Hủy' })
      .click()
    await expect(page.getByRole('dialog', { name: 'Tạo tài khoản nhân viên' })).toBeVisible()
    await expect(page.getByRole('dialog').getByLabel('Họ và tên')).toHaveValue('Không Tạo')
    await expect(page.getByRole('dialog').getByLabel('Họ và tên')).toBeEditable()
  })

  test('filters live in the URL: the Technician chip', async ({ page }) => {
    await signInAndWait(page, 'admin')
    await page.goto('/staff')
    await page.getByRole('button', { name: /^Kỹ thuật/ }).click()
    await expect(page).toHaveURL(/role=technician/)
    await expect(page.getByRole('row', { name: new RegExp(STAFF.technician.name) })).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp(STAFF.admin.name) })).toHaveCount(0)
    // A filter refines the page: it replaces the entry, so Back leaves the list (lib/history.ts).
    await page.goBack()
    await expect(page).not.toHaveURL(/\/staff/)
  })

  test('a Technician cannot open the staff page', async ({ page }) => {
    await signInAndWait(page, 'technician')
    await page.goto('/staff')
    await expect(page).toHaveURL(/wrong-app/)
  })
})
