import { Type } from '@sinclair/typebox'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { StaffPage } from '../../features/staff/staff-page'
import { searchParser } from '../../lib/search'

const Role = Type.Union([
  Type.Literal('admin'),
  Type.Literal('manager'),
  Type.Literal('technician'),
  Type.Literal('guard'),
])
const Status = Type.Union([
  Type.Literal('invited'),
  Type.Literal('active'),
  Type.Literal('locked'),
  Type.Literal('disabled'),
])
const StaffSearchSchema = Type.Object({
  role: Type.Optional(Role),
  status: Type.Optional(Status),
  q: Type.Optional(Type.String({ maxLength: 100 })),
  page: Type.Integer({ minimum: 1, maximum: 10_000 }),
  pageSize: Type.Integer({ minimum: 1, maximum: 50 }),
})

/** `/staff` and, over it, the dialog routes `/staff/new` and `/staff/$staffId/edit`: the list stays rendered behind them (DOC-67). */
export const Route = createFileRoute('/_app/staff')({
  staticData: { crumbs: ['web.shell.nav.group.system', 'web.shell.nav.staff'] },
  validateSearch: searchParser(StaffSearchSchema, { page: 1, pageSize: 10 }),
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
