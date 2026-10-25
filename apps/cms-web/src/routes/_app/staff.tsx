import { createFileRoute, Outlet } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { StaffPage } from '../../features/staff/staff-page'
import { f, searchParser } from '../../lib/search'

const SearchShape = {
  role: f.oneOf('admin', 'manager', 'technician', 'guard'),
  status: f.oneOf('invited', 'active', 'locked', 'disabled'),
  q: f.string(100),
  page: f.int(1, 10_000),
  pageSize: f.int(1, 50),
}

/** `/staff` and, over it, the dialog routes `/staff/new` and `/staff/$staffId/edit`: the list stays rendered behind them (DOC-67). */
export const Route = createFileRoute('/_app/staff')({
  staticData: { crumbs: ['web.shell.nav.group.system', 'web.shell.nav.staff'] },
  validateSearch: searchParser(SearchShape, { page: 1, pageSize: 10 }),
  component: Layout,
})

function Layout(): ReactElement {
  const search = Route.useSearch()
  return (
    <>
      <StaffPage search={search} />
      <Outlet />
    </>
  )
}
