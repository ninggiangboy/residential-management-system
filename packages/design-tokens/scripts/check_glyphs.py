"""DS-05 (DOC-54 §4.1): every shipped font file has the 147 Vietnamese characters, `đ`, `Đ` and `₫`.

Run by `src/fonts.test.ts` through `uv run --with fonttools --with brotli` (brotli reads woff2). Prints one line per
file with the missing characters; exits 1 when a file misses any.
"""

import sys
import unicodedata

from fontTools.ttLib import TTFont

VOWELS = "aăâeêioôơuưy"
TONES = ["", "̀", "́", "̃", "̉", "̣"]  # none, grave, acute, tilde, hook above, dot below


def required() -> list[str]:
    letters = [unicodedata.normalize("NFC", v + t) for v in VOWELS for t in TONES]
    chars = letters + [c.upper() for c in letters] + ["đ", "Đ", "₫"]
    assert len(chars) == 147 and all(len(c) == 1 for c in chars)
    return chars


def main(paths: list[str]) -> int:
    chars = required()
    failed = False
    for path in paths:
        cmap = TTFont(path).getBestCmap()
        missing = [c for c in chars if ord(c) not in cmap]
        failed = failed or bool(missing)
        print(f"{path}: {'missing ' + ''.join(missing) if missing else 'ok'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
