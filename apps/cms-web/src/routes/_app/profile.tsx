import { createFileRoute } from '@tanstack/react-router'
import { ProfilePage } from '../../features/profile/profile-page'

export const Route = createFileRoute('/_app/profile')({
  staticData: {
    crumbs: [
      { label: 'web.shell.brand.subtitle', to: '/' },
      { label: 'web.profile.title', to: '/profile' },
    ],
  },
  component: ProfilePage,
})
