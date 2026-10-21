/**
 * Rules for apps/* (DOC-12 §6.1). Run with `bun run check:arch`.
 */
const SERVER_ONLY =
  '^(modules|packages/core-(db|messaging|http|auth|runtime|storage|mail|telemetry|config|testing))/'

module.exports = {
  forbidden: [
    {
      name: 'clients-import-the-api-type-only',
      severity: 'error',
      from: { path: '^apps/(cms-web|resident-app|staff-app)/' },
      to: { path: '^apps/api/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'clients-do-not-import-server-code',
      severity: 'error',
      from: { path: '^apps/(cms-web|resident-app|staff-app)/' },
      to: { path: SERVER_ONLY },
    },
    {
      name: 'apps-do-not-import-each-other',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/[^/]+/', pathNot: ['^apps/$1/', '^apps/api/'] },
    },
    {
      name: 'only-main-and-app-import-the-container',
      severity: 'error',
      from: { path: '^apps/api/', pathNot: '^apps/api/src/(main|app)\\.ts$' },
      to: { path: '^apps/api/src/bootstrap/container\\.ts$' },
    },
    {
      name: 'api-uses-module-exports-only',
      severity: 'error',
      from: { path: '^apps/api/' },
      to: { path: '^modules/[^/]+/src/(domain|application|infrastructure|presentation)/' },
    },
    {
      name: 'api-does-not-import-drivers',
      severity: 'error',
      from: { path: '^apps/api/' },
      to: {
        path: 'node_modules/(drizzle-orm|postgres|jose|sharp|@aws-sdk|nodemailer|expo-server-sdk|exceljs|@react-pdf)/',
      },
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
