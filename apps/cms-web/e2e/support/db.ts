/**
 * A resident asks for the deletion of their account in the app (E-18, P6-04), which does not exist yet; `e2e/run.ts` sets the state
 * the request leaves (DOC-35 §10.1) in the database of the run. `phone` is as the Manager types it (`09…`).
 */
export async function requestDeletion(phone: string): Promise<void> {
  const control = process.env.E2E_CONTROL_URL
  if (!control) throw new Error('E2E_CONTROL_URL is not set: run the specs through e2e/run.ts')
  const response = await fetch(`${control}/deletion-request`, {
    method: 'POST',
    body: JSON.stringify({ phone: `+84${phone.slice(1)}` }),
  })
  if (response.status !== 204) throw new Error(`no active account with the phone ${phone}`)
}
