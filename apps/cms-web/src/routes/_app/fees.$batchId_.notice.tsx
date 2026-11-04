import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { FeeNoticePage } from '../../features/fee-notice/fee-notice-page'
import { loadFinanceText } from '../../lib/i18n'
import { f, searchParser } from '../../lib/search'

const SearchShape = {
  unit: f.string(40),
  lang: f.oneOf('vi', 'en', 'both'),
}

export const Route = createFileRoute('/_app/fees/$batchId_/notice')({
  staticData: {
    roles: ['admin', 'manager'],
    crumbs: [
      { label: 'web.shell.nav.group.finance', to: '/fees' },
      { label: 'web.shell.nav.fees', to: '/fees' },
    ],
  },
  validateSearch: searchParser(SearchShape),
  loader: loadFinanceText,
  component: Page,
})

function Page(): ReactElement {
  const { batchId } = Route.useParams()
  return <FeeNoticePage batchId={batchId} search={Route.useSearch()} />
}
