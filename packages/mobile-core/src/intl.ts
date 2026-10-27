// Hermes on Android has no `Intl.PluralRules`, and `intl-messageformat` throws on the first `plural` message (Unit-Pick, DR-71, DR-235).
// The polyfill installs itself only where the engine lacks it; the locale data is the two catalog languages.
import '@formatjs/intl-pluralrules/polyfill.js'
import '@formatjs/intl-pluralrules/locale-data/en.js'
import '@formatjs/intl-pluralrules/locale-data/vi.js'
