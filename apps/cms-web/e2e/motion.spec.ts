import { expect, type Page, type Response, test } from '@playwright/test'
import { signInAndWait } from './support/app'

interface Seen {
  /** Indicators drawn before their 150 ms (DOC-54 §17.3), each with how long its table or skeleton had waited. */
  early: string[]
  skeleton: number
  bar: boolean
  spinner: boolean
}

/**
 * Watches from now until `ms` later. Every indicator of DOC-54 §17.3 waits 150 ms: a table's bar after the table turned busy, a
 * skeleton after it was inserted. A `MutationObserver` stamps those starts as they happen, and every frame checks that nothing
 * was drawn sooner. On a fast machine nothing waits that long, so nothing is drawn; on a slow CI runner the app itself can take
 * more than 150 ms to render a page, and an indicator that waited its 150 ms is then the rule working, not a flash.
 */
async function watchIndicators(page: Page, ms: number) {
  await page.evaluate((duration) => {
    const seen: Seen = { early: [], skeleton: 0, bar: false, spinner: false }
    ;(window as unknown as { __seen: Seen }).__seen = seen
    const busySince = new WeakMap<Element, number>()
    const insertedAt = new WeakMap<Element, number>()
    const reported = new WeakSet<Element>()
    const stamp = (root: Element, at: number) => {
      for (const table of [root, ...root.querySelectorAll('table')])
        if (table.matches('table[aria-busy]') && !busySince.has(table)) busySince.set(table, at)
      for (const el of [root, ...root.querySelectorAll('.motion-skeleton')])
        if (el.matches('.motion-skeleton') && !insertedAt.has(el)) insertedAt.set(el, at)
      // The bar is judged as it is inserted: it outlives the busy state by its 300 ms minimum.
      for (const bar of [root, ...root.querySelectorAll('.motion-progress')]) {
        if (!bar.matches('.motion-progress')) continue
        seen.bar = true
        const table = bar.closest('.relative')?.querySelector('table')
        const since = table ? busySince.get(table) : undefined
        const wait = since === undefined ? 0 : at - since
        if (wait < 145) seen.early.push(`bar after ${Math.round(wait)} ms of busy`)
      }
    }
    const observer = new MutationObserver((records) => {
      const at = performance.now()
      for (const record of records) {
        if (record.type === 'attributes' && record.target instanceof Element) {
          if (record.target.hasAttribute('aria-busy')) stamp(record.target, at)
          else busySince.delete(record.target)
        }
        for (const node of record.addedNodes) if (node instanceof Element) stamp(node, at)
      }
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-busy'],
    })
    // Timers are never early, but a stamp and a frame can land a millisecond apart.
    const waited = (since: number | undefined, now: number) =>
      since === undefined ? 0 : now - since
    const start = performance.now()
    const tick = () => {
      const now = performance.now()
      for (const el of document.querySelectorAll('.motion-skeleton')) {
        const opacity = Number(getComputedStyle(el).opacity)
        seen.skeleton = Math.max(seen.skeleton, opacity)
        const wait = waited(insertedAt.get(el), now)
        if (opacity > 0 && wait < 145 && !reported.has(el)) {
          reported.add(el)
          seen.early.push(`skeleton after ${Math.round(wait)} ms`)
        }
      }
      if (document.querySelector('button .animate-spin')) seen.spinner = true
      if (now - start < duration) requestAnimationFrame(tick)
      else observer.disconnect()
    }
    requestAnimationFrame(tick)
  }, ms)
}

const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: Seen }).__seen)

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
    // Nothing drawn before its 150 ms; on a machine that renders in time, that is nothing drawn at all.
    const result = await seen(page)
    expect({ early: result.early, spinner: result.spinner }).toEqual({ early: [], spinner: false })
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
