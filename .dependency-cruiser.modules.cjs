/**
 * Rules for modules/* (DOC-12 §6.2). Paths are relative to the repository root. Run with `bun run check:arch`.
 */
const FRAMEWORKS =
  'node_modules/(elysia|@elysiajs|drizzle-orm|drizzle-kit|postgres|nodemailer|jose|pino|exceljs|@react-pdf|@aws-sdk|expo-server-sdk|libphonenumber-js)/'
const INNER_CORE_OK = '^packages/(core-kernel|shared-types)/'
const LAYERS = '(domain|application|infrastructure|presentation)'

module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      severity: 'error',
      from: { path: '^modules/[^/]+/src/domain/' },
      to: {
        path: [
          '^modules/[^/]+/src/(application|infrastructure|presentation)/',
          '^packages/',
          FRAMEWORKS,
        ],
        pathNot: INNER_CORE_OK,
      },
    },
    {
      name: 'application-no-infrastructure',
      severity: 'error',
      from: { path: '^modules/[^/]+/src/application/' },
      to: {
        path: [
          '^modules/[^/]+/src/(infrastructure|presentation)/',
          '^packages/core-(db|http|telemetry|runtime|config|storage|mail|auth)/',
          FRAMEWORKS,
        ],
      },
    },
    {
      name: 'presentation-no-infrastructure',
      severity: 'error',
      from: { path: '^modules/[^/]+/src/presentation/' },
      to: { path: ['^modules/[^/]+/src/infrastructure/', 'node_modules/(drizzle-orm|postgres)/'] },
    },
    {
      name: 'modules-talk-only-through-contracts',
      severity: 'error',
      from: { path: '^modules/([^/]+)/' },
      to: {
        path: '^modules/[^/]+/',
        pathNot: [
          '^modules/$1/',
          '^modules/[^/]+/src/contracts/',
          '^modules/[^/]+/package\\.json$',
        ],
      },
    },
    {
      name: 'contracts-are-self-contained',
      severity: 'error',
      from: { path: '^modules/[^/]+/src/contracts/' },
      to: {
        path: [`^modules/[^/]+/src/${LAYERS}/`, '^packages/(?!shared-types/)', FRAMEWORKS],
        pathNot: '^modules/[^/]+/src/contracts/',
      },
    },
    {
      name: 'integrations-use-contracts-only',
      severity: 'error',
      from: { path: '^modules/([^/]+)/src/integrations/' },
      to: { path: '^modules/[^/]+/src/(?!contracts/|integrations/)' },
    },
    {
      name: 'module-core-does-not-load-its-integrations',
      severity: 'error',
      from: { path: '^modules/([^/]+)/src/', pathNot: '^modules/[^/]+/src/integrations/' },
      to: { path: '^modules/[^/]+/src/integrations/', pathNot: '^modules/(?!$1/)' },
    },
    {
      name: 'realtime-is-a-leaf',
      severity: 'error',
      from: { path: '^modules/realtime/src/' },
      to: { path: '^modules/(?!realtime/)[^/]+/' },
    },
    {
      name: 'no-framework-in-domain-or-application',
      severity: 'error',
      from: { path: '^modules/[^/]+/src/(domain|application)/' },
      to: { path: FRAMEWORKS },
    },
    {
      name: 'modules-do-not-import-apps',
      severity: 'error',
      from: { path: '^modules/' },
      to: { path: '^apps/' },
    },
    {
      name: 'modules-import-only-what-they-can-resolve',
      severity: 'error',
      from: { path: '^modules/' },
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
