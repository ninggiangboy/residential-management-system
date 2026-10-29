import { expect, type Page, test } from '@playwright/test'
import { signInAndWait, unique } from './support/app'

const phone = () =>
  `09${String(10_000_000 + (Date.now() % 80_000_000) + Math.floor(Math.random() * 9_000)).slice(0, 8)}`

async function addUnit(page: Page, code: string, floor = '7'): Promise<void> {
  await page.goto('/units')
  // First: an empty list repeats the action in its empty state.
  await page.getByRole('button', { name: 'Thêm căn' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Thêm căn hộ' })
  await dialog.getByLabel('Mã căn').fill(code)
  await dialog.getByLabel('Tầng').fill(floor)
  await dialog.getByLabel('Số phòng ngủ').fill('2')
  await dialog.getByLabel('Diện tích').fill('68.5')
  await dialog.getByRole('button', { name: 'Thêm căn' }).click()
}

/** Adds a unit and waits for its detail page, so the URL that follows is the unit's. */
async function addUnitAndOpen(page: Page, code: string, floor = '7'): Promise<string> {
  await addUnit(page, code, floor)
  await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}/)
  return page.url()
}

test.describe('W-Units and W-Unit-Detail (UIWR-01…15)', () => {
  test('add a unit, see it in the list, and a duplicate code is refused (UIWR-05)', async ({
    page,
  }) => {
    const code = unique('U').toUpperCase().slice(0, 7)
    await signInAndWait(page, 'manager')
    await addUnit(page, code)
    await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}/)
    await expect(page.getByText(`Đã thêm căn ${code}`)).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Tầng 7, 2 phòng ngủ')
    await expect(page.getByText('Chưa có chủ hộ').first()).toBeVisible()

    await addUnit(page, code)
    await expect(
      page
        .getByRole('dialog')
        .getByText(/đã|already|in use/i)
        .first(),
    ).toBeVisible()
  })

  test('search needs two characters and the filters live in the URL (UIWR-02, 03)', async ({
    page,
  }) => {
    const code = unique('S').toUpperCase().slice(0, 7)
    await signInAndWait(page, 'manager')
    await addUnit(page, code, '12')
    await page.goto('/units')
    const search = page.getByLabel('Tìm căn hộ')
    await search.fill('S')
    await expect(page.getByText('Nhập ít nhất 2 ký tự.')).toBeVisible()
    await search.fill(code.slice(0, 4))
    await expect(page).toHaveURL(new RegExp(`q=${code.slice(0, 4)}`))
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible()
    await page.goto('/units?occupancy=vacant&floor=12')
    await expect(page.getByRole('row', { name: new RegExp(code) })).toBeVisible()
    await page.goto('/units?floor=99')
    await expect(page.getByText('Không có căn nào khớp bộ lọc')).toBeVisible()
  })

  test('give a person to a unit, transfer the ownership, and manage a member (UIWR-07…14, 24…28)', async ({
    page,
  }) => {
    const code = unique('H').toUpperCase().slice(0, 7)
    const ownerPhone = phone()
    await signInAndWait(page, 'manager')
    await addUnit(page, code)
    await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}/)
    const unitUrl = page.url()

    // The unit has no owner: the primary button opens the add panel with the unit filled in (UIWR-14).
    await page.getByRole('link', { name: 'Gán chủ hộ' }).click()
    await expect(page).toHaveURL(/\/residents\/new\?.*unitId=/)
    const panel = page.getByRole('dialog')
    await panel.getByLabel('SĐT đăng nhập').fill(ownerPhone)
    await panel.getByLabel('Họ tên').fill('Trần Văn Chủ')
    await panel.getByRole('button', { name: 'Tạo chủ hộ' }).click()
    await expect(page.getByText(`Đã tạo tài khoản và thêm vào căn ${code}`)).toBeVisible()
    await expect(page).toHaveURL(unitUrl)
    await expect(page.getByText('Chủ hộ Trần Văn Chủ')).toBeVisible()
    // The owner row has no "Xóa" (UIWR-13).
    const ownerRow = page.getByRole('row', { name: /Trần Văn Chủ/ })
    await expect(ownerRow.getByRole('button', { name: 'Xóa' })).toHaveCount(0)

    // A family member is added, locked, unlocked and removed (UIWR-11).
    await page.goto(
      unitUrl
        .replace(/\/units\//, '/residents/new?unitId=')
        .replace(/\/residents\/new\?unitId=([0-9a-f-]{36}).*/, '/residents/new?unitId=$1'),
    )
    const memberPanel = page.getByRole('dialog')
    await memberPanel.getByLabel('SĐT đăng nhập').fill(phone())
    await memberPanel.getByLabel('Họ tên').fill('Trần Thị Con')
    // The unit has an owner now: "Chủ hộ" is disabled and the role starts at a family member.
    await expect(memberPanel.getByRole('combobox', { name: 'Vai trò ở căn này' })).toContainText(
      'Thành viên gia đình',
    )
    await memberPanel.getByRole('button', { name: 'Thêm cư dân' }).click()
    await expect(page).toHaveURL(unitUrl)
    const memberRow = page.getByRole('row', { name: /Trần Thị Con/ })
    await expect(memberRow).toContainText('Đang dùng')
    await memberRow.getByRole('button', { name: 'Khóa' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Khóa', exact: true }).click()
    await expect(memberRow).toContainText('Đã khóa')
    await memberRow.getByRole('button', { name: 'Mở khóa' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Mở khóa' }).click()
    await expect(memberRow).toContainText('Đang dùng')

    // The transfer needs a reason of 5 characters, removes the members by default, and the history shows it (UIWR-08).
    await page.getByRole('button', { name: 'Chuyển chủ hộ' }).click()
    const transfer = page.getByRole('dialog', { name: /Chuyển chủ hộ/ })
    await transfer.getByLabel('SĐT chủ hộ mới').fill(phone())
    await transfer.getByLabel('Họ tên').fill('Lê Chủ Mới')
    await transfer.getByLabel('Lý do (ít nhất 5 ký tự)').fill('Bán')
    await expect(transfer.getByRole('button', { name: 'Chuyển chủ hộ' })).toBeDisabled()
    await transfer.getByLabel('Lý do (ít nhất 5 ký tự)').fill('Bán căn hộ cho người mới')
    await transfer.getByRole('button', { name: 'Chuyển chủ hộ' }).click()
    await expect(page.getByText(/Đã chuyển chủ hộ, đã xóa 2 người khỏi căn/)).toBeVisible()
    await expect(page.getByText('Chủ hộ Lê Chủ Mới')).toBeVisible()
    await page.getByRole('tab', { name: 'Lịch sử' }).click()
    await expect(page.getByText('Đổi chủ hộ').first()).toBeVisible()
  })

  test('a phone already in use is refused when changing a login phone (UIWR-10)', async ({
    page,
  }) => {
    const code = unique('P').toUpperCase().slice(0, 7)
    const first = phone()
    const other = phone()
    await signInAndWait(page, 'manager')
    const unitUrl = await addUnitAndOpen(page, code)
    for (const [number, name] of [
      [first, 'Phạm Một'],
      [other, 'Phạm Hai'],
    ] as const) {
      await page.goto(unitUrl.replace(/\/units\/([0-9a-f-]{36}).*/, '/residents/new?unitId=$1'))
      const panel = page.getByRole('dialog')
      await panel.getByLabel('SĐT đăng nhập').fill(number)
      await panel.getByLabel('Họ tên').fill(name)
      await panel.getByRole('combobox', { name: 'Vai trò ở căn này' }).click()
      await page.getByRole('option', { name: 'Thành viên gia đình' }).click()
      await panel.getByRole('button', { name: 'Thêm cư dân' }).click()
      await expect(page).toHaveURL(unitUrl)
    }
    const row = page.getByRole('row', { name: /Phạm Một/ })
    await row.getByRole('button', { name: 'Đổi SĐT' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('SĐT mới').fill(other)
    await dialog.getByRole('button', { name: 'Đổi SĐT' }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('alert')).toBeVisible()
  })
})
