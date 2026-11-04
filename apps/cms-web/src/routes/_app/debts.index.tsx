import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { DebtsPage } from '../../features/debts/debts-page'
import { loadFinanceText } from '../../lib/i18n'
import { f, searchParser } from '../../lib/search'

const SearchShape = {
  month: f.pattern(/^\d{4}-(0[1-9]|1[0-2])$/, 7),
  q: f.string(100),
  overdue: f.bool(),
  cursor: f.string(300),
}

export const Route = createFileRoute('/_app/debts/')({
  staticData: {
    roles: ['admin', 'manager'],
    crumbs: [
      { label: 'web.shell.nav.group.finance', to: '/fees' },
      { label: 'web.shell.nav.debts', to: '/debts' },
    ],
  },
  validateSearch: searchParser(SearchShape),
  loader: loadFinanceText,
  component: Page,
})

function Page(): ReactElement {
  return <DebtsPage search={Route.useSearch()} />
}
