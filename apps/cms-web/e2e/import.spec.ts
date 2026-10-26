import { expect, test } from '@playwright/test'
import { signInAndWait, unique } from './support/app'
import { workbook, xlsxFile } from './support/xlsx'

const phone = (n: number) => `0903${String(100000 + n).padStart(6, '0')}`

test.describe('W-Import (UIWR-30…42)', () => {
  test('import units: upload, check, save, and the units exist (UIWR-30, 32, 37, 38)', async ({
    page,
  }) => {
    const tag = unique('I').toUpperCase().slice(0, 6)
    await signInAndWait(page, 'manager')
    await page.goto('/units')
    // First: an empty list repeats both actions in its empty state, below the header ones.
    await page.getByRole('link', { name: 'Nhập từ Excel' }).first().click()
    await expect(page).toHaveURL(/\/import/)

    // 8 good rows (the first with an owner) and 2 bad ones.
    const rows: (string | number)[][] = [
      [`${tag}-1`, 3, 2, 70.5, 'Đang ở', 'Nguyễn Thị Mai', phone(Date.now() % 90000)],
    ]
    for (let i = 2; i <= 8; i++) rows.push([`${tag}-${i}`, i, 1, 45, 'Trống'])
    rows.push([`${tag}-9`, 'abc', 1, 45, 'Trống'], [`${tag}-8`, 4, 1, 45, 'Trống'])
    await page
      .locator('input[type=file]')
      .setInputFiles(xlsxFile('can-ho.xlsx', await workbook(rows)))

    await expect(page).toHaveURL(/importId=/)
    await expect(page.getByTestId('count-valid')).toHaveText('8')
    await expect(page.getByTestId('count-errors')).toHaveText('2')
    await expect(page.getByRole('heading', { name: 'Dòng lỗi' })).toBeVisible()
    // No ID number, no date of birth and no email anywhere on the page (UIWR-37).
    await expect(page.locator('body')).not.toContainText(/@/)

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Tải danh sách lỗi' }).click()
    expect((await download).suggestedFilename()).toMatch(/^import-errors-.+\.csv$/)

    // The page reopens the same preview after a reload from the URL (UIWR-40).
    await page.reload()
    await expect(page.getByTestId('count-valid')).toHaveText('8')

    const save = page.getByRole('button', { name: 'Lưu 8 dòng hợp lệ' })
    await save.dblclick()
    await expect(page.getByRole('heading', { name: 'Đã lưu' })).toBeVisible()
    await expect(page.getByText(/8 căn mới/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Lưu / })).toHaveCount(0)

    await page.getByRole('link', { name: 'Xem danh sách căn hộ' }).click()
    await page.getByRole('searchbox').or(page.getByLabel('Tìm căn hộ')).fill(`${tag}-1`)
    await expect(page.getByRole('row', { name: new RegExp(`${tag}-1`) })).toBeVisible()
  })

  test('a file with no header is a failed job, not an error page (UIWR-35)', async ({ page }) => {
    await signInAndWait(page, 'admin')
    await page.goto('/import')
    await page
      .locator('input[type=file]')
      .setInputFiles(xlsxFile('rong.xlsx', await workbook([['a', 'b']], ['x', 'y'])))
    await expect(
      page.getByText('Không thể kiểm tra tệp này.').or(page.getByRole('alert')),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /^Lưu / })).toHaveCount(0)
  })

  test('a file that is not .xlsx and a file over 5 MB are stopped in the browser (UIWR-36)', async ({
    page,
  }) => {
    await signInAndWait(page, 'manager')
    await page.goto('/import')
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b') })
    await expect(page.getByText('Chỉ nhận tệp Excel .xlsx.')).toBeVisible()
    await page.locator('input[type=file]').setInputFiles({
      name: 'big.xlsx',
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(5 * 1024 * 1024 + 100),
    })
    await expect(page.getByText('Tệp vượt quá 5 MB.')).toBeVisible()
  })

  test('the recent imports table lists the jobs and opens one (UIWR-41, 42)', async ({ page }) => {
    await signInAndWait(page, 'manager')
    await page.goto('/import')
    await expect(page.getByRole('heading', { name: 'Nhập gần đây' })).toBeVisible()
    const table = page.getByRole('table', { name: 'Nhập gần đây' })
    await expect(table.getByRole('row')).not.toHaveCount(1)
    await table.getByRole('button', { name: 'Mở' }).first().click()
    await expect(page).toHaveURL(/importId=/)
  })
})
