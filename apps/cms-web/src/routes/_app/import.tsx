import { Type } from '@sinclair/typebox'
import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ImportPage } from '../../features/import/import-page'
import { searchParser } from '../../lib/search'

const SearchSchema = Type.Object({
  kind: Type.Literal('unit_owner'),
  importId: Type.Optional(Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })),
})

export const Route = createFileRoute('/_app/import')({
  staticData: { crumbs: ['web.shell.nav.group.residents', 'web.import.title'] },
  validateSearch: searchParser(SearchSchema, { kind: 'unit_owner' }),
  component: Page,
})

function Page(): ReactElement {
  return <ImportPage importId={Route.useSearch().importId} />
}
