import { createFileRoute } from '@tanstack/react-router'
import type { ReactElement } from 'react'
import { ResidentAddDialog } from '../../features/residents/resident-add-dialog'

export const Route = createFileRoute('/_app/residents/new')({ component: Page })

function Page(): ReactElement {
  const search = Route.useSearch()
  return <ResidentAddDialog unitId={search.unitId} search={search} />
}
