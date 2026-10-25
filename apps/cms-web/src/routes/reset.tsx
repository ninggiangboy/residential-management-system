import { Type } from '@sinclair/typebox'
import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ResetScreen } from '../features/auth/reset-screen'
import { searchParser } from '../lib/search'

export const Route = createFileRoute('/reset')({
  validateSearch: searchParser(Type.Object({ token: Type.Optional(Type.String()) })),
  component: Page,
})

function Page(): ReactElement {
  return <ResetScreen kind="reset" token={Route.useSearch().token} />
}
