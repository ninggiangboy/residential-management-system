import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { UnitDetailPage } from '../../features/units/unit-detail-page'
import { f, searchParser } from '../../lib/search'

const SearchShape = {
  tab: f.oneOf('members', 'history'),
  dialog: f.oneOf('edit', 'transfer', 'phone', 'member'),
  membershipId: f.string(64),
}

export const Route = createFileRoute('/_app/units/$unitId')({
  staticData: {
    crumbs: [
      { label: 'web.shell.nav.group.residents', to: '/units' },
      { label: 'web.shell.nav.units', to: '/units' },
    ],
  },
  validateSearch: searchParser(SearchShape, { tab: 'members' }),
  component: Page,
})

function Page(): ReactElement {
  const { unitId } = Route.useParams()
  return <UnitDetailPage unitId={unitId} search={Route.useSearch()} />
}
