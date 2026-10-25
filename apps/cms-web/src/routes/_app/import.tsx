import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ImportPage } from '../../features/import/import-page'
import { f, searchParser } from '../../lib/search'

const SearchShape = {
  kind: f.oneOf('unit_owner'),
  importId: f.pattern(/^[0-9a-fA-F-]{36}$/, 36),
}

export const Route = createFileRoute('/_app/import')({
  staticData: { crumbs: ['web.shell.nav.group.residents', 'web.import.title'] },
  validateSearch: searchParser(SearchShape, { kind: 'unit_owner' }),
  component: Page,
})

function Page(): ReactElement {
  return <ImportPage importId={Route.useSearch().importId} />
}
