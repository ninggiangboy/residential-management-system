import { expect, test } from '@playwright/test'
import { signInAndWait, unique } from './support/app'
import {
  createPublishFeeBatch,
  feeTerm,
  seedUnitsWithOwners,
  uniquePhone,
  unitCode,
} from './support/finance'

/**
 * `W-Fee-Record` (DOC-66, UIWF-32, 33, 38): a unit with two open charges from two published batches, one cash payment of the
 * whole debt, the receipts it issues, and the void of that payment that opens the two charges again.
 */
test.describe('W-Fee-Record (UIWF-32, 33, 38)', () => {
  test('record a cash payment for the whole debt, then void the receipt (UIWF-32, 33, 38)', async ({
    page,
  }) => {
    const tag = unique('R').toUpperCase().slice(0, 6)
    const unit = unitCode(tag, 1)
    const term = feeTerm()
    const debt = '2.838.000'
    await signInAndWait(page, 'manager')
    await seedUnitsWithOwners(page, [
      { code: unit, ownerName: 'Phạm Văn D', ownerPhone: uniquePhone() },
    ])
    // Two published batches, so the unit owes two whole charges (2,488,000 + 350,000).
    await createPublishFeeBatch(page, {
      name: `Phí quản lý ${tag}`,
      month: term.month,
      due: term.due,
      rows: [{ unitCode: unit, item: 'Phí quản lý', quantity: 1, unitPrice: 2_488_000 }],
    })
    await createPublishFeeBatch(page, {
      name: `Phí nước ${tag}`,
      month: term.month,
      due: term.due,
      rows: [{ unitCode: unit, item: 'Phí nước', quantity: 1, unitPrice: 350_000 }],
    })

    // The unit's balance: two open charges and the total owed.
    await page.goto('/debts')
    await page.getByTestId(`debt-row-${unit}`).click()
    await expect(page).toHaveURL(/\/debts\/[0-9a-f-]{36}/)
    await expect(page.getByTestId('open-charge-row')).toHaveCount(2)
    await expect(page.getByTestId('tile-outstanding')).toHaveText(new RegExp(debt))

    // The payment dialog: both charges ticked, the sum read-only, two receipts planned.
    await page.getByTestId('record-payment').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('payment-sum')).toHaveValue(new RegExp(debt))
    await expect(dialog.getByTestId('payment-receipts')).toContainText('2 phiếu thu')
    await dialog.getByTestId('payment-submit').click()
    await expect(dialog).toContainText('Đã ghi nhận')
    await expect(dialog).toContainText('Phiếu thu')
    await expect(dialog.locator('ul > li')).toHaveCount(2)
    // "Đóng" is both the dialog's X and its footer button: the footer one closes it.
    await dialog.getByRole('button', { name: 'Đóng' }).last().click()

    // Paid in full: nothing is open, the total is zero and the receipt history holds the one payment.
    await expect(page.getByTestId('open-charge-row')).toHaveCount(0)
    await expect(page.getByTestId('open-empty')).toBeVisible()
    await expect(page.getByTestId('tile-outstanding')).toHaveText('0 đ')
    await expect(page.getByTestId('receipt-row')).toHaveCount(1)
    await expect(page.getByTestId('receipt-row')).toContainText('Hiệu lực')
    await expect(page.getByTestId('receipt-row')).toContainText('Tiền mặt')

    // A wrong entry is voided, not edited: the two charges are open again and the receipt is void.
    await page.getByTestId('receipt-void').first().click()
    const voidDialog = page.getByRole('dialog', { name: 'Hủy phiếu thu?' })
    await voidDialog.getByLabel('Lý do (ít nhất 5 ký tự)').fill('Nhập nhầm căn')
    await voidDialog.getByTestId('void-payment-submit').click()
    await expect(page.getByText(/Đã hủy phiếu thu/).first()).toBeVisible()
    await expect(page.getByTestId('open-charge-row')).toHaveCount(2)
    await expect(page.getByTestId('tile-outstanding')).toHaveText(new RegExp(debt))
    await expect(page.getByTestId('receipt-row')).toContainText('Đã hủy')
  })
})
