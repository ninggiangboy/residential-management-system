import { Type } from '@sinclair/typebox'
import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ResetScreen } from '../features/auth/reset-screen'
import { searchParser } from '../lib/search'

export const Route = createFileRoute('/invite')({
  validateSearch: searchParser(Type.Object({ token: Type.Optional(Type.String()) })),
  component: Page,
})

function Page(): ReactElement {
  return <ResetScreen kind="invite" token={Route.useSearch().token} />
}
