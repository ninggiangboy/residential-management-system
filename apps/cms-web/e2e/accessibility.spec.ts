import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'
import { signInAndWait } from './support/app'

/** DS-07, UIWO-10: no serious or critical violation on the main pages, in both themes (DOC-54 §12). */
async function check(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const serious = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  )
  expect(
    serious.map(
      (violation) =>
        `${label}: ${violation.id} (${violation.nodes.length}) ${violation.nodes[0]?.html.slice(0, 120)}`,
    ),
  ).toEqual([])
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`axe, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme })

    test('the sign-in pages', async ({ page }) => {
      await page.goto('/login')
      await expect(page.getByRole('heading', { name: 'Đăng nhập' })).toBeVisible()
      await check(page, 'login')
      await page.getByRole('button', { name: 'Quên mật khẩu' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await check(page, 'forgot dialog')
    })

    test('the signed-in pages', async ({ page }) => {
      await signInAndWait(page, 'admin')
      for (const [path, heading] of [
        ['/units', 'Căn hộ'],
        ['/residents', 'Cư dân'],
        ['/staff', 'Tài khoản nhân viên'],
        ['/building', 'Tòa nhà và cấu hình'],
        ['/profile', 'Hồ sơ cá nhân'],
        ['/import', 'Nhập căn hộ từ Excel'],
      ] as const) {
        await page.goto(path)
        await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
        await expect(page.locator('[aria-busy=true], .animate-pulse')).toHaveCount(0)
        await check(page, path)
      }
    })
  })
}
