import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { StaffFormDialog } from '../../features/staff/staff-form-dialog'

export const Route = createFileRoute('/_app/staff/$staffId/edit')({ component: Page })

function Page(): ReactElement {
  const { staffId } = Route.useParams()
  const search = Route.useSearch()
  return <StaffFormDialog staffId={staffId} search={search} />
}
