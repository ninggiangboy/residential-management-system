import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { FeeImportPage } from '../../features/fee-import/fee-import-page'
import { f, searchParser } from '../../lib/search'

const UUID = /^[0-9a-fA-F-]{36}$/
const SearchShape = {
  batchId: f.pattern(UUID, 36),
  importId: f.pattern(UUID, 36),
}

export const Route = createFileRoute('/_app/fees/import')({
  staticData: {
    roles: ['admin', 'manager'],
    crumbs: [
      { label: 'web.shell.nav.group.finance', to: '/fees' },
      { label: 'web.fee-import.title', to: '/fees/import' },
    ],
  },
  validateSearch: searchParser(SearchShape),
  component: Page,
})

function Page(): ReactElement {
  return <FeeImportPage search={Route.useSearch()} />
}
