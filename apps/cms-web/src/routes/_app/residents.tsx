import { Type } from '@sinclair/typebox'
import { createFileRoute, Outlet } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ResidentsPage } from '../../features/residents/residents-page'
import { searchParser } from '../../lib/search'

const MemberType = Type.Union([
  Type.Literal('owner'),
  Type.Literal('family'),
  Type.Literal('tenant'),
  Type.Literal('helper'),
])
const SearchSchema = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 100 })),
  unitId: Type.Optional(Type.String({ format: 'uuid', pattern: '^[0-9a-fA-F-]{36}$' })),
  memberType: Type.Optional(MemberType),
  status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('locked')])),
  deletion: Type.Optional(Type.Literal('requested')),
  neverSignedIn: Type.Optional(Type.Boolean()),
  cursor: Type.Optional(Type.String({ maxLength: 300 })),
  limit: Type.Integer({ minimum: 1, maximum: 200 }),
  dialog: Type.Optional(Type.Literal('profile')),
  accountId: Type.Optional(Type.String({ pattern: '^[0-9a-fA-F-]{36}$' })),
})

/** `/residents` and, over it, the add panel `/residents/new` (DOC-65): the list stays rendered behind the panel. */
export const Route = createFileRoute('/_app/residents')({
  staticData: { crumbs: ['web.shell.nav.group.residents', 'web.shell.nav.residents'] },
  validateSearch: searchParser(SearchSchema, { limit: 50 }),
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
