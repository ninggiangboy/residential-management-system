import { createFileRoute, Outlet } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ResidentsPage } from '../../features/residents/residents-page'
import { f, searchParser } from '../../lib/search'

const UUID = /^[0-9a-fA-F-]{36}$/
const SearchShape = {
  q: f.string(100),
  unitId: f.pattern(UUID, 36),
  memberType: f.oneOf('owner', 'family', 'tenant', 'helper'),
  status: f.oneOf('active', 'locked'),
  deletion: f.oneOf('requested'),
  neverSignedIn: f.bool(),
  cursor: f.string(300),
  limit: f.int(1, 200),
  dialog: f.oneOf('profile'),
  accountId: f.pattern(UUID, 36),
}

/** `/residents` and, over it, the add panel `/residents/new` (DOC-65): the list stays rendered behind the panel. */
export const Route = createFileRoute('/_app/residents')({
  staticData: {
    crumbs: [
      { label: 'web.shell.nav.group.residents', to: '/units' },
      { label: 'web.shell.nav.residents', to: '/residents' },
    ],
  },
  validateSearch: searchParser(SearchShape, { limit: 50 }),
  component: Layout,
})

function Layout(): ReactElement {
  return (
    <>
      <ResidentsPage search={Route.useSearch()} />
      <Outlet />
    </>
  )
}
