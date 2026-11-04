import { expect, test } from '@playwright/test'
import { signInAndWait, unique } from './support/app'
import {
  createPublishFeeBatch,
  feeTerm,
  seedUnitsWithOwners,
  uniquePhone,
  unitCode,
} from './support/finance'

/** Opens the header's overflow menu and picks an entry (the actions DOC-66 §4 keeps out of the button row). */
async function headerAction(page: import('@playwright/test').Page, label: string): Promise<void> {
  await page.getByTestId('batch-menu').getByRole('button', { name: 'Thao tác' }).click()
  await page.getByRole('menuitem', { name: label }).click()
}

/**
 * `W-Fee-Recall` (DOC-66, UIWF-43…47): a published batch with no payment recalls and voids every charge; a batch with a paid
 * charge opens the blocked view at once and stays published.
 */
test.describe('W-Fee-Recall (UIWF-43, 44, 47)', () => {
  test('recall a published batch with no payment voids every charge (UIWF-43, 47)', async ({
    page,
  }) => {
    const tag = unique('C').toUpperCase().slice(0, 6)
    const unitA = unitCode(tag, 1)
    const unitB = unitCode(tag, 2)
    const term = feeTerm()
    await signInAndWait(page, 'manager')
    await seedUnitsWithOwners(page, [
      { code: unitA, ownerName: 'Nguyễn Văn E', ownerPhone: uniquePhone() },
      { code: unitB, ownerName: 'Trần Thị F', ownerPhone: uniquePhone() },
    ])
    await createPublishFeeBatch(page, {
      name: `Phí ${tag}`,
      month: term.month,
      due: term.due,
      rows: [
        { unitCode: unitA, item: 'Phí quản lý', quantity: 1, unitPrice: 248_000 },
        { unitCode: unitB, item: 'Phí quản lý', quantity: 1, unitPrice: 248_000 },
      ],
    })

    await headerAction(page, 'Thu hồi đợt')
    const dialog = page.getByRole('dialog', { name: /Thu hồi đợt/ })
    await expect(dialog.getByTestId('fee-recall-body')).toContainText('2 khoản')
    await dialog.getByTestId('fee-recall-reason').fill('Nhập sai đơn giá phí quản lý')
    await dialog.getByTestId('fee-recall-submit').click()

    // E-96 voided both charges and moved the batch to `recalled`.
    await expect(page.getByText(/Đã thu hồi .* khoản đã hủy/).first()).toBeVisible()
    await expect(page.getByTestId('banner-recalled')).toBeVisible()
    for (const unit of [unitA, unitB]) {
      await expect(page.getByTestId(`charge-row-${unit}`)).toContainText('Đã hủy')
      await expect(page.getByTestId(`charge-row-${unit}`)).toContainText('Thu hồi đợt')
    }

    // The dialog leaves with its exit motion and only then clears `dialog=recall` from the URL (`useExit`); a reload that
    // starts before that navigation is aborted (`net::ERR_ABORTED`), so wait for it.
    await expect(dialog).toBeHidden()
    await expect(page).not.toHaveURL(/dialog=recall/)

    // A reloaded recalled batch keeps "Phát hành lại" as its only header action.
    await page.reload()
    await expect(page.getByTestId('banner-recalled')).toBeVisible()
    await expect(page.getByTestId('reissue')).toBeVisible()
    await expect(page.getByTestId('publish')).toHaveCount(0)
  })

  test('a batch with a paid charge opens the blocked view and stays published (UIWF-44)', async ({
    page,
  }) => {
    const tag = unique('D').toUpperCase().slice(0, 6)
    const unitA = unitCode(tag, 1)
    const unitB = unitCode(tag, 2)
    const term = feeTerm()
    await signInAndWait(page, 'manager')
    await seedUnitsWithOwners(page, [
      { code: unitA, ownerName: 'Nguyễn Văn G', ownerPhone: uniquePhone() },
      { code: unitB, ownerName: 'Trần Thị H', ownerPhone: uniquePhone() },
    ])
    const batch = await createPublishFeeBatch(page, {
      name: `Phí ${tag}`,
      month: term.month,
      due: term.due,
      rows: [
        { unitCode: unitA, item: 'Phí quản lý', quantity: 1, unitPrice: 248_000 },
        { unitCode: unitB, item: 'Phí quản lý', quantity: 1, unitPrice: 248_000 },
      ],
    })

    // One charge is paid: the recall then has a payment to lose.
    await page.goto('/debts')
    await page.getByTestId(`debt-row-${unitA}`).click()
    await page.getByTestId('record-payment').click()
    const payment = page.getByRole('dialog')
    await payment.getByTestId('payment-submit').click()
    await expect(payment).toContainText('Đã ghi nhận')
    await payment.getByRole('button', { name: 'Đóng' }).last().click()

    // The recall dialog opens already blocked: the paid count of E-91 is above zero.
    await page.goto(`/fees/${batch.batchId}`)
    await headerAction(page, 'Thu hồi đợt')
    const dialog = page.getByRole('dialog', { name: /Thu hồi đợt/ })
    await expect(dialog.getByTestId('fee-recall-blocked')).toBeVisible()
    await expect(dialog.getByTestId('fee-recall-view-paid')).toContainText('1 khoản')
    await expect(dialog.getByTestId('fee-recall-reason')).toHaveCount(0)
    await expect(dialog.getByTestId('fee-recall-submit')).toHaveCount(0)
    await dialog.getByTestId('fee-recall-close').click()

    // Nothing changed: the batch is still published.
    await expect(page.getByRole('link', { name: 'Xuất PDF hàng loạt' })).toBeVisible()
  })
})
