/** The rules of DOC-26 §4.2, checked first on the device: 8 to 128 characters, a letter and a digit, both fields equal. */
export function passwordRules(password: string, confirm: string) {
  return {
    length: password.length >= 8 && password.length <= 128,
    mix: /\p{L}/u.test(password) && /\d/.test(password),
    match: password !== '' && password === confirm,
  }
}
