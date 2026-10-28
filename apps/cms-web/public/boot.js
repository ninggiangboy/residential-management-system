// Runs before the first paint. It is a file and not an inline script so that a `script-src 'self'` policy allows it.
// 1. The stored theme (DR-304), so a pinned theme does not flash the other one; `src/lib/theme.ts` owns the key and every later
//    change.
// 2. The first paint is the frame of the page drawn in `index.html` (`#boot`), not a blank page while the scripts load and the
//    session is restored (DR-306): the shell on a signed-in path, the hero panel on the sign-in page; `src/main.tsx` removes it.
//    The other public pages (reset, invitation) draw as soon as the scripts run and start on the plain background.
try {
  const theme = localStorage.getItem('rms.theme')
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
} catch (_) {
  // Blocked site data: the page follows the operating system.
}
if (/^\/login\/?$/.test(location.pathname)) document.documentElement.dataset.boot = 'login'
else if (!/^\/(forgot|reset|invite|wrong-app)(\/|$)/.test(location.pathname)) {
  document.documentElement.dataset.boot = 'shell'
}
