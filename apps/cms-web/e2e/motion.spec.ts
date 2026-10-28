import { expect, type Page, test } from '@playwright/test'
import { signInAndWait } from './support/app'

/**
 * Records, frame by frame from now until `ms` later, the most opaque skeleton, and whether a table's loading bar or a button's
 * spinner was drawn (DOC-54 §17). The API of this run answers in a few milliseconds (`DEV_LATENCY_MS=0`).
 */
async function watchIndicators(page: Page, ms: number) {
  await page.evaluate((duration) => {
    const w = window as unknown as { __seen: { skeleton: number; bar: boolean; spinner: boolean } }
    w.__seen = { skeleton: 0, bar: false, spinner: false }
    const start = performance.now()
    const tick = () => {
      for (const el of document.querySelectorAll('.motion-skeleton'))
        w.__seen.skeleton = Math.max(w.__seen.skeleton, Number(getComputedStyle(el).opacity))
      if (document.querySelector('.motion-progress')) w.__seen.bar = true
      if (document.querySelector('button .animate-spin')) w.__seen.spinner = true
      if (performance.now() - start < duration) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, ms)
}

const seen = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __seen: { skeleton: number; bar: boolean; spinner: boolean } })
        .__seen,
  )

test.describe('Motion and loading at any API speed (DOC-54 §17)', () => {
  test('DS-09 a fast answer shows no skeleton, no loading bar and no spinner', async ({ page }) => {
    await signInAndWait(page, 'admin')
    await expect(page.getByRole('heading', { name: 'Căn hộ', level: 1 })).toBeVisible()

    // A page change and a filter, each answered well under 150 ms.
    await watchIndicators(page, 1200)
    await page.getByRole('link', { name: 'Nhân viên', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Tài khoản nhân viên', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: /^Admin/ }).click()
    await expect(page).toHaveURL(/role=admin/)
    await page.waitForTimeout(1300)
    expect(await seen(page)).toEqual({ skeleton: 0, bar: false, spinner: false })
  })

  test('DS-10 a side panel its route unmounts slides out before the route changes', async ({
    page,
  }) => {
    await signInAndWait(page, 'admin')
    await page.goto('/staff/new')
    const dialog = page.getByRole('dialog', { name: 'Tạo tài khoản nhân viên' })
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', { name: 'Hủy' }).click()
    // During the exit motion the panel is still drawn, closing, and the address has not changed yet (`useExit`).
    await expect(page.locator('[role=dialog][data-state=closed]')).toHaveCount(1, { timeout: 100 })
    await expect(page).toHaveURL(/\/staff\/new/)
    // Then the route changes and the panel is gone.
    await expect(page).toHaveURL(/\/staff(\?|$)/)
    await expect(dialog).toHaveCount(0)
  })
})
