import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { BuildingPage } from '../../features/building/building-page'
import { f, searchParser } from '../../lib/search'

const SearchShape = {
  dialog: f.oneOf('terms'),
  kind: f.oneOf('terms', 'privacy'),
}

/** Admin only: a Manager opening the URL gets the Forbidden state, and the sidebar has no entry (UIWS-20). */
export const Route = createFileRoute('/_app/building')({
  staticData: {
    crumbs: [
      { label: 'web.shell.nav.group.system', to: '/staff' },
      { label: 'web.shell.nav.building', to: '/building' },
    ],
    roles: ['admin'],
  },
  validateSearch: searchParser(SearchShape, { kind: 'terms' }),
  component: Page,
})

function Page(): ReactElement {
  const { dialog, kind } = Route.useSearch()
  return <BuildingPage dialog={dialog} kind={kind} />
}
