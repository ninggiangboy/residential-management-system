import { expect, type Request, test } from '@playwright/test'
import { signInAndWait } from './support/app'

/** The error reporter and the route boundary (DOC-55 §15, CL-18, CL-19, E-04). */

const REPORT_KEYS = [
  'app',
  'appVersion',
  'errorName',
  'kind',
  'message',
  'platform',
  'screen',
  'stack',
]

const isReport = (request: Request) =>
  request.method() === 'POST' && request.url().endsWith('/client-errors')

test.describe('error reports', () => {
  test('a script error is reported once as a crash, without the query of a URL, and the server answers 204', async ({
    page,
  }) => {
    await signInAndWait(page, 'manager')
    const reported = page.waitForRequest(isReport)
    const answered = page.waitForResponse((response) => isReport(response.request()))
    await page.evaluate(() => {
      setTimeout(() => {
        throw new TypeError('Cannot load https://example.vn/api/v1/staff/residents?q=0901234567')
      })
    })
    const body = (await reported).postDataJSON() as Record<string, string>
    expect(body).toMatchObject({
      app: 'web',
      platform: 'web',
      kind: 'crash',
      errorName: 'TypeError',
      message: 'Cannot load https://example.vn/api/v1/staff/residents',
    })
    expect(Object.keys(body).every((key) => REPORT_KEYS.includes(key))).toBe(true)
    expect((await answered).status()).toBe(204)
  })

  test('a render error shows the boundary with a reference and a Reload button, and reports once (CL-18)', async ({
    page,
  }) => {
    await signInAndWait(page, 'manager')
    // A list that is not a list breaks the page while it renders; the shell around it stays.
    await page.route('**/staff/units?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: 5 }),
      }),
    )
    const reports: Record<string, string>[] = []
    page.on('request', (request) => {
      if (isReport(request)) reports.push(request.postDataJSON() as Record<string, string>)
    })
    await page.goto('/units')
    await expect(page.getByText('Có gì đó chưa ổn')).toBeVisible()
    await expect(page.getByText(/Mã tham chiếu: [0-9a-f-]{36}/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tải lại' })).toBeVisible()
    await expect.poll(() => reports.length).toBe(1)
    expect(reports[0]).toMatchObject({ kind: 'render', screen: '/units/' })
    expect(reports[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/)
  })
})
