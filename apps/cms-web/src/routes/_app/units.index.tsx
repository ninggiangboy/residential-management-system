import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { UnitsPage } from '../../features/units/units-page'
import { f, searchParser } from '../../lib/search'

const SearchShape = {
  q: f.string(100),
  occupancy: f.oneOf('occupied', 'rented', 'vacant'),
  floor: f.int(-5, 150),
  bedrooms: f.int(0, 20),
  unitTypeId: f.string(64),
  cursor: f.string(300),
  limit: f.int(1, 200),
  dialog: f.oneOf('add'),
}

export const Route = createFileRoute('/_app/units/')({
  staticData: {
    crumbs: [
      { label: 'web.shell.nav.group.residents', to: '/units' },
      { label: 'web.shell.nav.units', to: '/units' },
    ],
  },
  validateSearch: searchParser(SearchShape, { limit: 50 }),
  component: Page,
})

function Page(): ReactElement {
  return <UnitsPage search={Route.useSearch()} />
}
