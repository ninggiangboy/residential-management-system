import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ResetScreen } from '../features/auth/reset-screen'
import { f, searchParser } from '../lib/search'

export const Route = createFileRoute('/reset')({
  validateSearch: searchParser({ token: f.string(200) }),
  component: Page,
})

function Page(): ReactElement {
  return <ResetScreen kind="reset" token={Route.useSearch().token} />
}
