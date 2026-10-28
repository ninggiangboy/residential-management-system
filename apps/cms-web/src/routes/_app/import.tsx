import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ImportPage } from '../../features/import/import-page'
import { f, searchParser } from '../../lib/search'

const SearchShape = {
  kind: f.oneOf('unit_owner'),
  importId: f.pattern(/^[0-9a-fA-F-]{36}$/, 36),
}

export const Route = createFileRoute('/_app/import')({
  staticData: {
    crumbs: [
      { label: 'web.shell.nav.group.residents', to: '/units' },
      { label: 'web.import.title', to: '/import' },
    ],
  },
  validateSearch: searchParser(SearchShape, { kind: 'unit_owner' }),
  component: Page,
})

function Page(): ReactElement {
  return <ImportPage importId={Route.useSearch().importId} />
}
