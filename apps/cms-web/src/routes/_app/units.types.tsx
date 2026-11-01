import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { UnitTypesPage } from '../../features/unit-types/unit-types-page'
import { f, searchParser } from '../../lib/search'

const SearchShape = {
  dialog: f.oneOf('add', 'edit'),
  unitTypeId: f.string(64),
}

export const Route = createFileRoute('/_app/units/types')({
  staticData: {
    crumbs: [
      { label: 'web.shell.nav.group.residents', to: '/units' },
      { label: 'web.shell.nav.unit-types', to: '/units/types' },
    ],
  },
  validateSearch: searchParser(SearchShape),
  component: Page,
})

function Page(): ReactElement {
  return <UnitTypesPage search={Route.useSearch()} />
}
