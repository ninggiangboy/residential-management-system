import { Type } from '@sinclair/typebox'
import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { UnitsPage } from '../../features/units/units-page'
import { searchParser } from '../../lib/search'

const SearchSchema = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 100 })),
  occupancy: Type.Optional(
    Type.Union([Type.Literal('occupied'), Type.Literal('rented'), Type.Literal('vacant')]),
  ),
  floor: Type.Optional(Type.Integer({ minimum: -5, maximum: 150 })),
  bedrooms: Type.Optional(Type.Integer({ minimum: 0, maximum: 20 })),
  cursor: Type.Optional(Type.String({ maxLength: 300 })),
  limit: Type.Integer({ minimum: 1, maximum: 200 }),
  dialog: Type.Optional(Type.Literal('add')),
})

export const Route = createFileRoute('/_app/units/')({
  staticData: { crumbs: ['web.shell.nav.group.residents', 'web.shell.nav.units'] },
  validateSearch: searchParser(SearchSchema, { limit: 50 }),
  component: Page,
})

function Page(): ReactElement {
  return <UnitsPage search={Route.useSearch()} />
}
