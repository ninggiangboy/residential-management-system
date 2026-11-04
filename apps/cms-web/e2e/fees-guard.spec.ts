import { expect, test } from '@playwright/test'
import { signInAndWait } from './support/app'

/**
 * The finance guard (DOC-66 §2, UIWF-04, 64): a Technician or Guard is a non-web role and never reaches `/fees` or `/debts`;
 * a Manager sees the "Tài chính" group and opens both screens.
 */
test.describe('the finance guard (UIWF-04, 64)', () => {
  test('a Technician cannot open the finance screens and lands on the wrong-app page', async ({
    page,
  }) => {
    await signInAndWait(page, 'technician')
    await expect(page).toHaveURL(/\/wrong-app/)
    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' })
    await expect(nav.getByRole('link', { name: 'Đợt phí' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Công nợ' })).toHaveCount(0)

    await page.goto('/fees')
    await expect(page).toHaveURL(/\/wrong-app/)
    await expect(page.getByRole('heading', { name: 'Đợt phí' })).toHaveCount(0)

    await page.goto('/debts')
    await expect(page).toHaveURL(/\/wrong-app/)
    await expect(page.getByRole('heading', { name: 'Công nợ' })).toHaveCount(0)
  })

  test('a Manager sees the "Tài chính" group and opens both screens (UIWF-01)', async ({
    page,
  }) => {
    await signInAndWait(page, 'manager')
    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' })
    await expect(nav.getByText('Tài chính')).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Đợt phí' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Công nợ' })).toBeVisible()

    await nav.getByRole('link', { name: 'Đợt phí' }).click()
    await expect(page).toHaveURL(/\/fees(\?|$)/)
    await expect(page.getByRole('heading', { name: 'Đợt phí' })).toBeVisible()

    await nav.getByRole('link', { name: 'Công nợ' }).click()
    await expect(page).toHaveURL(/\/debts(\?|$)/)
    await expect(page.getByRole('heading', { name: 'Công nợ' })).toBeVisible()
  })
})
