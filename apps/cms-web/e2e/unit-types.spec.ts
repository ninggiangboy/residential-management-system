import { expect, type Page, test } from '@playwright/test'
import { signInAndWait, unique } from './support/app'

/** `W-Unit-Types` and the type of a unit across `W-Units`, `W-Unit-Detail` (DOC-65, UIWR-43…53; DR-314, DR-315). */

const typeCode = () => `e2e_${Math.random().toString(36).slice(2, 8)}`

async function addType(
  page: Page,
  code: string,
  name: string,
  defaults: { bedrooms?: string; area?: string } = {},
): Promise<void> {
  await page.goto('/units/types')
  await page.getByRole('button', { name: 'Thêm loại căn hộ' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Thêm loại căn hộ' })
  await dialog.getByLabel(/^Mã/).fill(code)
  await dialog.getByLabel('Tên tiếng Việt').fill(name)
  if (defaults.bedrooms) await dialog.getByLabel('Số phòng ngủ').fill(defaults.bedrooms)
  if (defaults.area) await dialog.getByLabel('Diện tích').fill(defaults.area)
  await dialog.getByRole('button', { name: 'Thêm loại' }).click()
}

test.describe('W-Unit-Types (UIWR-46…51)', () => {
  test('add a type, see it with its defaults and no units, and a duplicate code and name are refused (UIWR-47, 48)', async ({
    page,
  }) => {
    const code = typeCode()
    const name = `Loại ${code}`
    await signInAndWait(page, 'manager')
    await addType(page, code, name, { bedrooms: '3', area: '120' })
    await expect(page.getByText(`Đã thêm loại ${name}`)).toBeVisible()
    const row = page.getByRole('row', { name: new RegExp(code) })
    await expect(row).toContainText(name)
    await expect(row).toContainText('3PN')
    await expect(row).toContainText('Đang dùng')

    await addType(page, code, `${name} khác`)
    const dialog = page.getByRole('dialog', { name: 'Thêm loại căn hộ' })
    await expect(dialog.getByText('Mã loại này đã được dùng.')).toBeVisible()
    await dialog.getByLabel(/^Mã/).fill(typeCode())
    await dialog.getByLabel('Tên tiếng Việt').fill(name.toUpperCase())
    await dialog.getByRole('button', { name: 'Thêm loại' }).click()
    await expect(dialog.getByText('Tên loại này đã được dùng.')).toBeVisible()
  })

  test('edit: the code is read-only, only the defaults change, then archive and restore (UIWR-49, 50)', async ({
    page,
  }) => {
    const code = typeCode()
    const name = `Loại ${code}`
    await signInAndWait(page, 'manager')
    await addType(page, code, name, { bedrooms: '2', area: '60' })
    await page.getByRole('row', { name: new RegExp(code) }).click()
    const dialog = page.getByRole('dialog', { name: 'Sửa loại căn hộ' })
    await expect(dialog.getByLabel(/^Mã/)).toHaveAttribute('readonly', '')
    await dialog.getByLabel('Diện tích').fill('70')
    await dialog.getByRole('button', { name: 'Lưu' }).click()
    await expect(page.getByText(`Đã lưu loại ${name}`)).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp(code) })).toContainText('70')

    // Archive: the tag reads "Ngừng dùng" and the type leaves the add dialog of W-Units.
    await page.getByRole('row', { name: new RegExp(code) }).click()
    const edit = page.getByRole('dialog', { name: 'Sửa loại căn hộ' })
    await edit.getByRole('switch', { name: 'Đang dùng' }).click()
    await edit.getByRole('button', { name: 'Lưu' }).click()
    await expect(page.getByRole('row', { name: new RegExp(code) })).toContainText('Ngừng dùng')

    await page.goto('/units')
    await page.getByRole('button', { name: 'Thêm căn' }).first().click()
    await page
      .getByRole('dialog', { name: 'Thêm căn hộ' })
      .getByRole('combobox', { name: 'Loại căn hộ' })
      .click()
    await expect(page.getByRole('option', { name })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Restore.
    await page.goto('/units/types')
    await page.getByRole('row', { name: new RegExp(code) }).click()
    const again = page.getByRole('dialog', { name: 'Sửa loại căn hộ' })
    await again.getByRole('switch', { name: 'Đang dùng' }).click()
    await again.getByRole('button', { name: 'Lưu' }).click()
    await expect(page.getByRole('row', { name: new RegExp(code) })).toContainText('Đang dùng')
  })
})

test.describe('the type of a unit (UIWR-43…45)', () => {
  test('picking a type fills the fields that were not typed, and a typed value is kept (UIWR-44)', async ({
    page,
  }) => {
    const code = typeCode()
    const name = `Loại ${code}`
    await signInAndWait(page, 'manager')
    await addType(page, code, name, { bedrooms: '0', area: '32' })
    await expect(page.getByText(`Đã thêm loại ${name}`)).toBeVisible()

    await page.goto('/units')
    await page.getByRole('button', { name: 'Thêm căn' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Thêm căn hộ' })
    await dialog.getByRole('combobox', { name: 'Loại căn hộ' }).click()
    await page.getByRole('option', { name }).click()
    await expect(dialog.getByLabel('Số phòng ngủ')).toHaveValue('0')
    await expect(dialog.getByLabel('Diện tích')).toHaveValue('32.00')
    await expect(dialog.getByText(`Lấy từ loại ${name}`)).toBeVisible()

    // A second dialog: the bedrooms are typed first, so the type leaves them alone.
    await dialog.getByRole('button', { name: 'Hủy' }).click()
    // Closing goes back one history entry (`useCloseOverlay`), which the browser does after the click returns: a dialog opened
    // before that lands is closed by it. Wait for the first one to be gone before opening the next.
    await expect(dialog).toBeHidden()
    await expect(page).not.toHaveURL(/dialog=add/)
    await page.getByRole('button', { name: 'Thêm căn' }).first().click()
    const second = page.getByRole('dialog', { name: 'Thêm căn hộ' })
    await second.getByLabel('Số phòng ngủ').fill('2')
    await second.getByRole('combobox', { name: 'Loại căn hộ' }).click()
    await page.getByRole('option', { name }).click()
    await expect(second.getByLabel('Số phòng ngủ')).toHaveValue('2')
    await expect(second.getByLabel('Diện tích')).toHaveValue('32.00')

    // Save it: the unit shows its type and the list filters by it (UIWR-43, 45).
    const unitCode = unique('T').toUpperCase().slice(0, 7)
    await second.getByLabel('Mã căn').fill(unitCode)
    await second.getByRole('button', { name: 'Thêm căn' }).click()
    await expect(page).toHaveURL(/\/units\/[0-9a-f-]{36}/)
    await expect(page.getByRole('heading', { level: 1 }).locator('..')).toContainText(name)
    await page.goto('/units')
    await page.getByRole('combobox', { name: 'Loại', exact: true }).click()
    await page.getByRole('option', { name }).click()
    await expect(page).toHaveURL(/unitTypeId=/)
    await expect(page.getByRole('row', { name: new RegExp(unitCode) })).toContainText(name)
    await expect(page.getByRole('row', { name: new RegExp(unitCode) })).toContainText('2PN')
  })
})

test('a Technician is sent to /wrong-app and E-180 is never called (UIWR-53)', async ({ page }) => {
  const calls: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/staff/unit-types')) calls.push(request.url())
  })
  await signInAndWait(page, 'technician')
  await page.goto('/units/types')
  await expect(page).toHaveURL(/wrong-app/)
  expect(calls).toEqual([])
})
