import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ResetScreen } from '../features/auth/reset-screen'
import { f, searchParser } from '../lib/search'

export const Route = createFileRoute('/invite')({
  validateSearch: searchParser({ token: f.string(200) }),
  component: Page,
})

function Page(): ReactElement {
  return <ResetScreen kind="invite" token={Route.useSearch().token} />
}
