// Publishes the next version of the terms of use as the demo Admin (E-53, DOC-35 §9.2): from then on every resident is refused with
// 403 `terms_required` at the next unit request, until the account accepts it. Runs on the host, so `localhost` is the API of
// `bun run dev`, the same one the app reaches through `adb reverse` or the simulator's network.
const api = 'http://localhost:3000/api/v1'
const headers = { 'Content-Type': 'application/json' }

const login = http.post(`${api}/auth/staff/login`, {
  headers,
  body: JSON.stringify({
    email: 'admin@demo.rms.invalid',
    password: 'demo-password-1',
    client: 'app',
  }),
})
if (!login.ok) throw new Error(`demo Admin sign-in answered ${login.status}`)

const published = http.post(`${api}/staff/terms`, {
  headers: { ...headers, Authorization: `Bearer ${json(login.body).accessToken}` },
  body: JSON.stringify({
    kind: 'terms',
    text: { vi: '## DEMO — không phải văn bản pháp lý\n\nPhiên bản do một flow Maestro xuất bản.' },
  }),
})
if (!published.ok) throw new Error(`publishing the terms answered ${published.status}`)
