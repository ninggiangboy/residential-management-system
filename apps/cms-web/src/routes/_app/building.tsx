import { Type } from '@sinclair/typebox'
import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { BuildingPage } from '../../features/building/building-page'
import { searchParser } from '../../lib/search'

const SearchSchema = Type.Object({
  dialog: Type.Optional(Type.Literal('terms')),
  kind: Type.Union([Type.Literal('terms'), Type.Literal('privacy')]),
})

/** Admin only: a Manager opening the URL gets the Forbidden state, and the sidebar has no entry (UIWS-20). */
export const Route = createFileRoute('/_app/building')({
  staticData: {
    crumbs: ['web.shell.nav.group.system', 'web.shell.nav.building'],
    roles: ['admin'],
  },
  validateSearch: searchParser(SearchSchema, { kind: 'terms' }),
  component: Page,
})

function Page(): ReactElement {
  const { dialog, kind } = Route.useSearch()
  return <BuildingPage dialog={dialog} kind={kind} />
}
