import { createFileRoute } from '@tanstack/react-router'
import { ProfilePage } from '../../features/profile/profile-page'

export const Route = createFileRoute('/_app/profile')({
  staticData: { crumbs: ['web.shell.brand.subtitle', 'web.profile.title'] },
  component: ProfilePage,
})
