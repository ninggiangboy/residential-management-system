import { expect, type Page, test } from '@playwright/test'
import { API_URL, signInAndWait, unique } from './support/app'
import { requestDeletion } from './support/db'
import { PASSWORD, STAFF } from './support/seed'

const phone = () =>
  `09${String(10_000_000 + (Date.now() % 80_000_000) + Math.floor(Math.random() * 9_000)).slice(0, 8)}`

/** A unit with an owner, made through the screens a Manager uses. */
async function unitWithOwner(
  page: Page,
  name: string,
  ownerPhone: string,
): Promise<{ code: string; url: string }> {
  const code = unique('R').toUpperCase().slice(0, 7)
  await page.goto('/units')
  // First: an empty list repeats the action in its empty state.
  await page.getByRole('button', { name: 'Thêm căn' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Thêm căn hộ' })
  await dialog.getByLabel('Mã căn *').fill(code)
  await dialog.getByRole('button', { name: 'Thêm căn' }).click()
  await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}/)
  const url = page.url()
  await page.getByRole('link', { name: 'Gán chủ hộ' }).click()
  const panel = page.getByRole('dialog')
  await panel.getByLabel('SĐT đăng nhập').fill(ownerPhone)
  await panel.getByLabel('Họ tên *').fill(name)
  await panel.getByRole('button', { name: 'Tạo chủ hộ' }).click()
  await expect(page).toHaveURL(url)
  return { code, url }
}

test.describe('W-Residents and W-Resident-Add (UIWR-16…29)', () => {
  test('search by name and by phone, with the hint below the minimum (UIWR-16, 17)', async ({
    page,
  }) => {
    const ownerPhone = phone()
    await signInAndWait(page, 'manager')
    await unitWithOwner(page, 'Nguyễn Văn Tìm', ownerPhone)
    await page.goto('/residents')
    const search = page.getByLabel('Tìm cư dân')
    await search.fill('ng')
    await expect(page.getByText('Nhập tên từ 3 ký tự hoặc SĐT từ 4 chữ số.')).toBeVisible()
    await search.fill('nguyen van tim')
    await expect(page.getByRole('row', { name: /Nguyễn Văn Tìm/ })).toBeVisible()
    await search.fill(ownerPhone.slice(-4))
    await expect(page.getByRole('row', { name: /Nguyễn Văn Tìm/ })).toBeVisible()
    // The list holds no ID number, no date of birth and no email (UIWR-17).
    const text = await page.locator('table').innerText()
    expect(text).not.toMatch(/@|CCCD|\d{9,12}\b/)
  })

  test('the member-type chip and the status filter live in the URL (UIWR-18, 19)', async ({
    page,
  }) => {
    await signInAndWait(page, 'manager')
    await page.goto('/residents')
    await page.getByRole('button', { name: 'Chủ hộ' }).click()
    await expect(page).toHaveURL(/memberType=owner/)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Chủ hộ' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.getByRole('combobox', { name: 'Trạng thái tài khoản' }).click()
    await page.getByRole('option', { name: 'Chưa đăng nhập' }).click()
    await expect(page).toHaveURL(/neverSignedIn=true/)
    await expect(page).not.toHaveURL(/status=/)
  })

  test('the profile dialog shows the ID number, saves only what changed, and each open is a new read (UIWR-20, 21)', async ({
    page,
  }) => {
    const ownerPhone = phone()
    await signInAndWait(page, 'manager')
    await unitWithOwner(page, 'Đặng Hồ Sơ', ownerPhone)
    await page.goto(`/residents?q=${ownerPhone.slice(-6)}`)
    const reads: string[] = []
    page.on('request', (request) => {
      if (/\/staff\/residents\/[0-9a-f-]{36}$/.test(request.url()) && request.method() === 'GET')
        reads.push(request.url())
    })
    await page.getByRole('button', { name: /Sửa hồ sơ Đặng Hồ Sơ/ }).click()
    const dialog = page.getByRole('dialog', { name: /Hồ sơ cư dân/ })
    await expect(dialog.getByLabel('Họ tên *')).toHaveValue('Đặng Hồ Sơ')
    await dialog.getByLabel('Số CCCD').fill('079085012345')
    await dialog.getByLabel('Ngày sinh').fill('03/04/1985')
    const patches: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'PATCH') patches.push(request.postData() ?? '')
    })
    await dialog.getByRole('button', { name: 'Lưu hồ sơ' }).click()
    await expect(page.getByText('Đã lưu hồ sơ')).toBeVisible()
    expect(patches).toHaveLength(1)
    expect(JSON.parse(patches[0] ?? '{}')).toEqual({
      cccd: '079085012345',
      dateOfBirth: '1985-04-03',
    })
    // Opened again: one more read, and the saved number is there.
    await page.getByRole('button', { name: /Sửa hồ sơ Đặng Hồ Sơ/ }).click()
    await expect(page.getByRole('dialog').getByLabel('Số CCCD')).toHaveValue('079085012345')
    expect(reads.length).toBe(2)
  })

  test('an existing phone is linked, showing the name and the masked ID number only (UIWR-25)', async ({
    page,
  }) => {
    const ownerPhone = phone()
    await signInAndWait(page, 'manager')
    await unitWithOwner(page, 'Phạm Có Sẵn', ownerPhone)
    // A second unit gets the same person as a tenant.
    const second = unique('T').toUpperCase().slice(0, 7)
    await page.goto('/units')
    await page.getByRole('button', { name: 'Thêm căn' }).first().click()
    await page.getByRole('dialog', { name: 'Thêm căn hộ' }).getByLabel('Mã căn *').fill(second)
    await page.getByRole('dialog').getByRole('button', { name: 'Thêm căn' }).click()
    await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}/)
    const secondUrl = page.url()
    await page.goto(secondUrl.replace(/\/units\/([0-9a-f-]{36}).*/, '/residents/new?unitId=$1'))
    const panel = page.getByRole('dialog')
    await panel.getByLabel('SĐT đăng nhập').fill(ownerPhone)
    await expect(panel.getByText('SĐT này đã có tài khoản')).toBeVisible()
    await expect(panel.getByText('Phạm Có Sẵn')).toBeVisible()
    await expect(panel.getByLabel('Họ tên *')).toHaveCount(0)
    await panel.getByRole('combobox', { name: 'Vai trò ở căn này' }).click()
    await page.getByRole('option', { name: 'Người thuê' }).click()
    await expect(panel.getByLabel('Được phép thanh toán')).toBeVisible()
    await panel.getByRole('button', { name: new RegExp(`Liên kết căn ${second}`) }).click()
    await expect(page.getByText(`Đã liên kết căn ${second} với tài khoản có sẵn`)).toBeVisible()
    await expect(page).toHaveURL(secondUrl)
  })

  test('a unit that has an owner offers no "Chủ hộ" (UIWR-26)', async ({ page }) => {
    await signInAndWait(page, 'manager')
    const { url } = await unitWithOwner(page, 'Võ Đã Có Chủ', phone())
    await page.goto(url.replace(/\/units\/([0-9a-f-]{36}).*/, '/residents/new?unitId=$1'))
    const panel = page.getByRole('dialog')
    await expect(
      panel.getByText('Căn này đã có chủ hộ. Muốn đổi chủ hộ, dùng Chuyển chủ hộ.'),
    ).toBeVisible()
    await panel.getByRole('combobox', { name: 'Vai trò ở căn này' }).click()
    await expect(page.getByRole('option', { name: 'Chủ hộ' })).toHaveAttribute('data-disabled', '')
  })
  test('approving the deletion of an owner names the unit with a link and changes nothing (UIWR-22)', async ({
    page,
  }) => {
    const ownerPhone = phone()
    await signInAndWait(page, 'manager')
    const { code, url } = await unitWithOwner(page, 'Phạm Chủ Căn', ownerPhone)
    await requestDeletion(ownerPhone)
    await page.goto(`/residents?q=${ownerPhone.slice(-6)}`)
    await page.getByRole('button', { name: /Sửa hồ sơ Phạm Chủ Căn/ }).click()
    const profile = page.getByRole('dialog', { name: /Hồ sơ cư dân/ })
    await expect(profile.getByText(/Yêu cầu xóa tài khoản ngày/)).toBeVisible()
    await profile.getByRole('button', { name: 'Duyệt yêu cầu xóa' }).click()
    const confirm = page.getByRole('alertdialog')
    await confirm.getByRole('button', { name: 'Duyệt xóa' }).click()
    await expect(confirm.getByText(/Chuyển chủ hộ của căn/)).toBeVisible()
    await confirm.getByRole('link', { name: code }).click()
    await expect(page).toHaveURL(url)
    await page.goto(`/residents?q=${ownerPhone.slice(-6)}`)
    await page.getByRole('button', { name: /Sửa hồ sơ Phạm Chủ Căn/ }).click()
    await expect(
      page.getByRole('dialog', { name: /Hồ sơ cư dân/ }).getByText(/Yêu cầu xóa tài khoản ngày/),
    ).toBeVisible()
  })

  test('approving the deletion of a member shows the execution date (UIWR-23)', async ({
    page,
    request,
  }) => {
    const memberPhone = phone()
    await signInAndWait(page, 'manager')
    const { url } = await unitWithOwner(page, 'Đỗ Chủ Hộ', phone())
    const login = await request.post(`${API_URL}/auth/staff/login`, {
      data: { email: STAFF.manager.email, password: PASSWORD, client: 'app' },
    })
    const { accessToken } = (await login.json()) as { accessToken: string }
    const created = await request.post(`${API_URL}/staff/residents`, {
      headers: { authorization: `Bearer ${accessToken}`, 'idempotency-key': crypto.randomUUID() },
      data: {
        unitId: /[0-9a-f]{8}-[0-9a-f-]{27}/.exec(url)?.[0],
        phone: memberPhone,
        fullName: 'Lý Thành Viên',
        memberType: 'family',
      },
    })
    expect(created.status(), await created.text()).toBe(201)
    await requestDeletion(memberPhone)
    await page.goto(`/residents?q=${memberPhone.slice(-6)}`)
    await page.getByRole('button', { name: /Sửa hồ sơ Lý Thành Viên/ }).click()
    const profile = page.getByRole('dialog', { name: /Hồ sơ cư dân/ })
    await profile.getByRole('button', { name: 'Duyệt yêu cầu xóa' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Duyệt xóa' }).click()
    await expect(profile.getByText(/Đã duyệt, sẽ xóa vào/)).toBeVisible()
    await expect(profile.getByRole('button', { name: 'Duyệt yêu cầu xóa' })).toHaveCount(0)
    await profile.getByRole('button', { name: 'Đóng' }).last().click()
    await expect(page.getByRole('row', { name: /Lý Thành Viên/ })).toContainText(
      'Yêu cầu xóa tài khoản',
    )
  })
})
