/**
 * The email typed on `S-Login` is kept in memory for `S-Forgot` and back (DOC-61 `S-Forgot` §2: "the typed email is passed in
 * memory"). It is never written to storage and is gone when the app is killed.
 */
let draft = ''

export const emailDraft = {
  get: () => draft,
  set(next: string) {
    draft = next
  },
}

/** `tran.minh@mocmien.vn` as `tr***@mocmien.vn`: it reveals nothing about whether the account exists (UISM-12). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return email
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`
}
