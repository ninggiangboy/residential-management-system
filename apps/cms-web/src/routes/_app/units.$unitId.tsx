import { Type } from '@sinclair/typebox'
import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { UnitDetailPage } from '../../features/units/unit-detail-page'
import { searchParser } from '../../lib/search'

const SearchSchema = Type.Object({
  tab: Type.Union([Type.Literal('members'), Type.Literal('history')]),
  dialog: Type.Optional(
    Type.Union([
      Type.Literal('edit'),
      Type.Literal('transfer'),
      Type.Literal('phone'),
      Type.Literal('member'),
    ]),
  ),
  membershipId: Type.Optional(Type.String({ maxLength: 64 })),
})

export const Route = createFileRoute('/_app/units/$unitId')({
  staticData: { crumbs: ['web.shell.nav.group.residents', 'web.shell.nav.units'] },
  validateSearch: searchParser(SearchSchema, { tab: 'members' }),
  component: Page,
})

function Page(): ReactElement {
  const { unitId } = Route.useParams()
  return <UnitDetailPage unitId={unitId} search={Route.useSearch()} />
}
