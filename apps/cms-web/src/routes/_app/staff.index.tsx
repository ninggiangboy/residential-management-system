import { createFileRoute } from '@tanstack/react-router'

/** The list is rendered by the layout route, so that the dialog routes can sit over it. */
export const Route = createFileRoute('/_app/staff/')({ component: () => null })
