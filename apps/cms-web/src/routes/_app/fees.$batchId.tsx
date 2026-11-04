import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { FeeBatchPage } from '../../features/fee-batch/fee-batch-page'
import { f, searchParser } from '../../lib/search'

const SearchShape = {
  view: f.oneOf('all', 'missing'),
  q: f.string(100),
  unit: f.string(40),
  dialog: f.oneOf('recall', 'void', 'reissue', 'extend', 'publish', 'discard', 'close'),
  charge: f.pattern(/^[0-9a-fA-F-]{36}$/, 36),
  cursor: f.string(300),
}

export const Route = createFileRoute('/_app/fees/$batchId')({
  staticData: {
    roles: ['admin', 'manager'],
    crumbs: [
      { label: 'web.shell.nav.group.finance', to: '/fees' },
      { label: 'web.shell.nav.fees', to: '/fees' },
    ],
  },
  validateSearch: searchParser(SearchShape, { view: 'all' }),
  component: Page,
})

function Page(): ReactElement {
  const { batchId } = Route.useParams()
  return <FeeBatchPage batchId={batchId} search={Route.useSearch()} />
}
