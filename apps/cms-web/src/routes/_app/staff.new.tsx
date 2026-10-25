import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { StaffFormDialog } from '../../features/staff/staff-form-dialog'

export const Route = createFileRoute('/_app/staff/new')({ component: Page })

function Page(): ReactElement {
  const search = Route.useSearch()
  return <StaffFormDialog search={search} />
}
