import { expect, type Page, type Response, test } from '@playwright/test'
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

/** A page change to the staff list, then its Admin filter: the two steps DS-09 watches. */
async function staffPageThenFilter(page: Page) {
  await page.getByRole('link', { name: 'Nhân viên', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tài khoản nhân viên', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: /^Admin/ }).click()
  await expect(page).toHaveURL(/role=admin/)
}

test.describe('Motion and loading at any API speed (DOC-54 §17)', () => {
  test('DS-09 a fast answer shows no skeleton, no loading bar and no spinner', async ({ page }) => {
    // DS-09 starts from an API that answers in a few milliseconds. `DEV_LATENCY_MS=0` is not enough on a CI runner, where a list
    // request alone can take more than 150 ms. So a first pass records the answers of the API, and the watched pass gets them
    // back at once: the check is on the UI's timing, not the runner's.
    const answers = new Map<
      string,
      { status: number; headers: Record<string, string>; body: Buffer }
    >()
    const recording: Promise<void>[] = []
    const record = (response: Response) => {
      const request = response.request()
      const streamed = response.headers()['content-type']?.includes('text/event-stream')
      if (request.method() !== 'GET' || !request.url().includes('/api/v1/') || streamed) return
      recording.push(
        response.body().then(
          (body) => {
            answers.set(request.url(), {
              status: response.status(),
              headers: response.headers(),
              body,
            })
          },
          () => undefined,
        ),
      )
    }
    page.on('response', record)
    await signInAndWait(page, 'admin')
    await expect(page.getByRole('heading', { name: 'Căn hộ', level: 1 })).toBeVisible()
    await expect(page.locator('table[aria-busy]')).toHaveCount(0)
    await staffPageThenFilter(page)
    await expect(page.locator('table[aria-busy]')).toHaveCount(0)
    page.off('response', record)
    await Promise.all(recording)

    // A new document empties the query cache, so the watched pass fetches again, each answer served from the recording.
    await page.route('**/api/v1/**', (route) => {
      const answer = route.request().method() === 'GET' && answers.get(route.request().url())
      return answer ? route.fulfill(answer) : route.continue()
    })
    await page.goto('/units')
    await expect(page.getByRole('heading', { name: 'Căn hộ', level: 1 })).toBeVisible()
    await expect(page.locator('table[aria-busy]')).toHaveCount(0)

    await watchIndicators(page, 1200)
    await staffPageThenFilter(page)
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
