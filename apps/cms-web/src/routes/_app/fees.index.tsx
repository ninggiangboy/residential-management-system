import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { FeesPage } from '../../features/fees/fees-page'
import { loadFinanceText } from '../../lib/i18n'
import { f, searchParser } from '../../lib/search'

const SearchShape = {
  status: f.oneOf('all', 'draft', 'published', 'closed', 'recalled'),
  month: f.pattern(/^\d{4}-(0[1-9]|1[0-2])$/, 7),
  q: f.string(100),
  cursor: f.string(300),
  limit: f.int(1, 100),
}

export const Route = createFileRoute('/_app/fees/')({
  staticData: {
    roles: ['admin', 'manager'],
    crumbs: [
      { label: 'web.shell.nav.group.finance', to: '/fees' },
      { label: 'web.shell.nav.fees', to: '/fees' },
    ],
  },
  validateSearch: searchParser(SearchShape, { status: 'all', limit: 20 }),
  loader: loadFinanceText,
  component: Page,
})

function Page(): ReactElement {
  return <FeesPage search={Route.useSearch()} />
}
