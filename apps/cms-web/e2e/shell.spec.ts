import { expect, test } from '@playwright/test'
import { signInAndWait } from './support/app'

test.describe('Web app shell (DOC-64)', () => {
  test('the sidebar collapses to the rail, keeps the choice, and shows tooltips only in the rail (DR-312)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signInAndWait(page, 'manager')
    const sidebar = page.locator('#sidebar')
    const residents = page
      .getByRole('navigation', { name: 'Điều hướng chính' })
      .getByRole('link', { name: 'Cư dân' })
    await expect(sidebar).toHaveCSS('width', '248px')
    await residents.hover()
    await page.waitForTimeout(500)
    await expect(page.getByRole('tooltip')).toHaveCount(0)

    await page.getByRole('button', { name: 'Thu gọn thanh bên' }).click()
    await expect(sidebar).toHaveCSS('width', '72px')
    await residents.hover()
    await expect(page.getByRole('tooltip', { name: 'Cư dân' })).toBeVisible()

    // A new load opens at the stored width from its first frame (`boot.js`), not wide and then narrow.
    await page.goto('/staff', { waitUntil: 'domcontentloaded' })
    expect(await page.evaluate(() => document.documentElement.dataset.sidebar)).toBe('collapsed')
    await expect(sidebar).toHaveCSS('width', '72px')

    await page.getByRole('button', { name: 'Mở rộng thanh bên' }).click()
    await expect(sidebar).toHaveCSS('width', '248px')
    expect(await page.evaluate(() => localStorage.getItem('rms.sidebar'))).toBeNull()

    // Below 1024 px the sidebar is always the rail and the toggle is not drawn.
    await page.setViewportSize({ width: 900, height: 900 })
    await expect(sidebar).toHaveCSS('width', '72px')
    await expect(page.getByRole('button', { name: /thanh bên/ })).toBeHidden()
  })
})
