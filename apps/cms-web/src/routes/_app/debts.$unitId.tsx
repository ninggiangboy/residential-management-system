import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { FeeRecordPage } from '../../features/fee-record/fee-record-page'
import { loadFinanceText } from '../../lib/i18n'
import { f, searchParser } from '../../lib/search'

const UUID = /^[0-9a-fA-F-]{36}$/
const SearchShape = {
  dialog: f.oneOf('payment', 'void-payment', 'void'),
  charge: f.pattern(UUID, 36),
  payment: f.pattern(UUID, 36),
  payments: f.string(300),
}

export const Route = createFileRoute('/_app/debts/$unitId')({
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
  const { unitId } = Route.useParams()
  return <FeeRecordPage unitId={unitId} search={Route.useSearch()} />
}
