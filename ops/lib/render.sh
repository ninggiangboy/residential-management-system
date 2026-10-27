#!/usr/bin/env bash
# render_template <file> <NAME>...: prints the file with every `${NAME}` replaced by the value of the environment variable NAME.
# Not `envsubst` (gettext may be missing on a host) and not bash 4 features (the tests also run on macOS); the replacement is
# literal, so a value with `&`, `\` or `/` is safe. A name that is not listed stays as written.
render_template() {
  local file="$1"
  shift
  RENDER_NAMES="$*" awk '
    function replace(s, find, rep,   out, i) {
      out = ""
      while ((i = index(s, find)) > 0) { out = out substr(s, 1, i - 1) rep; s = substr(s, i + length(find)) }
      return out s
    }
    BEGIN { n = split(ENVIRON["RENDER_NAMES"], names, " ") }
    { line = $0; for (k = 1; k <= n; k++) line = replace(line, "${" names[k] "}", ENVIRON[names[k]]); print line }
  ' "$file"
}
