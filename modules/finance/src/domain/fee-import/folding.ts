/**
 * The key of a text for matching (DOC-18 §1.1, §2.1): compatibility decomposition, combining marks removed, `đ` written `d`, lower
 * case, and every character that is not a letter or digit removed. Headers, kind values and the item key of DQ-75 compare by it.
 */
export const foldKey = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}]/gu, '')
