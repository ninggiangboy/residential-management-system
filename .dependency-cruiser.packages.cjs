/**
 * Rules for packages/* (DOC-12 §6.3): which other workspace packages each may import, and which
 * packages may use a framework. `ALLOWED` was recomputed from the vendored package.json files in P1-02 (production imports only; tests are excluded).
 * A package is liftable into its own repository exactly when none of these rules needs bending.
 */
const ALLOWED = {
  'core-kernel': [],
  'core-config': [],
  'core-context': [],
  'core-telemetry': ['core-config', 'core-context'],
  'core-db': ['core-kernel', 'core-config'],
  'core-messaging': ['core-kernel', 'core-db', 'core-config', 'core-context', 'core-telemetry'],
  'core-http': ['core-kernel', 'core-context', 'core-telemetry'],
  'core-auth': ['core-kernel', 'core-context', 'core-http'],
  'core-mail': ['core-kernel', 'core-config', 'core-messaging'],
  'core-storage': ['core-kernel', 'core-config'],
  'core-runtime': [
    'core-kernel',
    'core-config',
    'core-db',
    'core-messaging',
    'core-telemetry',
    'core-mail',
    'core-storage',
  ],
  'core-i18n': [],
  'core-testing': ['core-kernel', 'core-messaging', 'core-mail', 'core-storage'],
  'core-web': [],
  'shared-types': [],
  'design-tokens': [],
  'i18n-catalog': ['shared-types'],
  'ui-native': ['design-tokens', 'shared-types', 'core-i18n'],
  'client-core': ['shared-types'],
  'mobile-core': ['shared-types', 'client-core', 'i18n-catalog', 'core-i18n'],
  'pdf-assets': [],
}

const rule = (pkg, allowed) => ({
  name: `${pkg}-imports-only-its-allowed-packages`,
  severity: 'error',
  from: { path: `^packages/${pkg}/` },
  to: {
    path: '^packages/',
    pathNot: [`^packages/${pkg}/`, ...allowed.map((a) => `^packages/${a}/`)],
  },
})

module.exports = {
  forbidden: [
    ...Object.entries(ALLOWED).map(([pkg, allowed]) => rule(pkg, allowed)),
    {
      name: 'packages-do-not-import-modules-or-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^(modules|apps)/' },
    },
    {
      name: 'only-adapters-import-frameworks',
      severity: 'error',
      from: { path: '^packages/core-(kernel|context|config|i18n)/' },
      to: { path: 'node_modules/(elysia|@elysiajs|drizzle-orm|postgres|nodemailer|pino|jose)/' },
    },
    {
      name: 'packages-import-only-what-they-can-resolve',
      severity: 'error',
      from: { path: '^packages/' },
      to: { couldNotResolve: true },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    tsPreCompilationDeps: true,
    exclude: { path: '\\.test\\.ts$' },
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['bun', 'import', 'default'],
    },
  },
}
