/**
 * The key of a text for matching (DOC-18 §1.1): compatibility decomposition (so `²` becomes `2`), combining marks removed, `đ`
 * written `d`, lower case, and every character that is not a letter or digit removed. Headers, occupancy words and the "same
 * person" test of DQ-31 all compare by this key.
 */
export const foldKey = (text: string): string =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^\p{L}\p{N}]/gu, '')
