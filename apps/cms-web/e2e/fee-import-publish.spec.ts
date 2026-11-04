import { expect, test } from '@playwright/test'
import { signInAndWait, unique } from './support/app'
import {
  createFeeBatch,
  feeBatchWorkbook,
  feeTerm,
  seedUnitsWithOwners,
  uniquePhone,
  unitCode,
} from './support/finance'
import { xlsxFile } from './support/xlsx'

/**
 * `W-Fee-Import` from the UI into a new draft, then `W-Fee-Batch` publish (DOC-66, UIWF-06, 13, 18, 19): the settings, the
 * file and its preview with the counts and the error row, the commit, and the published batch with its total and charge count.
 */
test.describe('W-Fee-Import and W-Fee-Batch (UIWF-06, 13, 18, 19)', () => {
  test('import a fee file into a new draft, commit it, and publish the batch (UIWF-06, 18, 19)', async ({
    page,
  }) => {
    const tag = unique('F').toUpperCase().slice(0, 6)
    const unitA = unitCode(tag, 1)
    const unitB = unitCode(tag, 2)
    // Not seeded: a fee row for a unit that does not exist is the one error row (§4.3, DQ-77).
    const missing = unitCode(tag, 9)
    const term = feeTerm()
    await signInAndWait(page, 'manager')
    await seedUnitsWithOwners(page, [
      { code: unitA, ownerName: 'Nguyễn Thị A', ownerPhone: uniquePhone() },
      { code: unitB, ownerName: 'Trần Văn B', ownerPhone: uniquePhone() },
    ])

    // Step 1: the settings and the file, as a person fills them in.
    await page.goto('/fees/import')
    await expect(page.getByRole('heading', { name: 'Nhập đợt phí từ Excel' })).toBeVisible()
    await page.getByTestId('fee-import-month').fill(term.month)
    await page.getByTestId('fee-import-due').fill(term.due)
    await page.getByTestId('fee-import-name').fill(`Phí ${tag}`)
    await page.locator('input[type=file]').setInputFiles(
      xlsxFile(
        'dot-phi.xlsx',
        await feeBatchWorkbook(
          [
            { unitCode: unitA, item: 'Phí quản lý', quantity: 1, unitPrice: 2_488_000 },
            { unitCode: unitB, item: 'Phí nước', quantity: 2, unitPrice: 45_000 },
            { unitCode: missing, item: 'Phí quản lý', quantity: 1, unitPrice: 100_000 },
          ],
          term.month,
        ),
      ),
    )
    await expect(page.getByTestId('fee-import-check')).toBeEnabled()
    await page.getByTestId('fee-import-check').click()

    // Step 2: the preview — E-90 created the draft, E-72 validated the file.
    await expect(page.getByTestId('fee-import-preview')).toBeVisible()
    await expect(page).toHaveURL(/importId=/)
    await expect(page.getByTestId('count-rows')).toHaveText('3')
    await expect(page.getByTestId('count-valid')).toHaveText('2')
    await expect(page.getByTestId('count-errors')).toHaveText('1')
    await expect(page.getByTestId('count-total')).toContainText('2.578.000')
    await expect(page.getByTestId('error-row')).toHaveCount(1)
    await expect(page.getByTestId('error-row')).toContainText(missing)
    await expect(page.getByTestId('error-row')).toContainText('Dòng 4')

    // Step 3: the commit replaces the draft's charges with the valid rows.
    const save = page.getByTestId('save-batch')
    await expect(save).toContainText('2')
    await save.click()
    const done = page.getByTestId('import-done')
    await expect(done).toContainText('2 khoản phí')
    await page.getByTestId('result-open-batch').click()
    await expect(page).toHaveURL(/\/fees\/[0-9a-f-]{36}/)

    // The draft: the charges of the two valid rows and the totals.
    await expect(page.getByTestId('totals-units')).toContainText('2 căn')
    await expect(page.getByTestId('totals-lines')).toContainText('2 khoản')
    await expect(page.getByTestId('totals-lines')).toContainText('2.578.000')
    await expect(page.getByTestId(`charge-row-${unitA}`)).toContainText('2.488.000')
    await expect(page.getByTestId(`charge-row-${unitB}`)).toContainText('90.000')
    await expect(page.getByTestId(`charge-row-${missing}`)).toHaveCount(0)

    // Publish: the checks line, then E-95 with the batch's `If-Match`.
    await page.getByTestId('publish').click()
    await expect(page.getByTestId('publish-summary')).toContainText('2 khoản')
    await page.getByTestId('publish-confirm').click()
    await expect(page.getByRole('link', { name: 'Xuất PDF hàng loạt' })).toBeVisible()
    await expect(page.getByTestId(`charge-row-${unitA}`)).toContainText('Chưa nộp')
    await expect(page.getByTestId(`charge-row-${unitB}`)).toContainText('Chưa nộp')
  })

  test('a draft opened from the URL fills the settings and locks its fee month (UIWF-13)', async ({
    page,
  }) => {
    const tag = unique('G').toUpperCase().slice(0, 6)
    const unit = unitCode(tag, 1)
    const term = feeTerm()
    const name = `Phí ${tag}`
    await signInAndWait(page, 'manager')
    await seedUnitsWithOwners(page, [
      { code: unit, ownerName: 'Lê Thị C', ownerPhone: uniquePhone() },
    ])
    const batch = await createFeeBatch(page, {
      name,
      month: term.month,
      due: term.due,
      rows: [{ unitCode: unit, item: 'Phí quản lý', quantity: 1, unitPrice: 500_000 }],
    })

    await page.goto(`/fees/import?batchId=${batch.batchId}`)
    await expect(page.getByTestId('fee-import-name')).toHaveValue(name)
    const month = page.getByTestId('fee-import-month')
    await expect(month).toBeDisabled()
    await expect(month).toHaveValue(term.month)
  })
})
