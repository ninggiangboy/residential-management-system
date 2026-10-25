import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { publicConfigQuery } from '../api/hooks/public-config'
import { staffMeQuery } from '../api/hooks/staff-me'
import { ensureSession, signOut } from '../auth/session'
import { PublicLayout } from '../components/layout/public-layout'
import { Button, buttonStyles } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Icon } from '../components/ui/icon'
import { isWebRole, LANDING } from '../features/auth/landing'
import { useI18n } from '../lib/i18n'

export const Route = createFileRoute('/wrong-app')({
  beforeLoad: async ({ context, location }) => {
    const me = await ensureSession(context.queryClient)
    if (!me) throw redirect({ to: '/login', search: { redirect: location.href } })
    if (isWebRole(me.role)) throw redirect({ href: LANDING })
  },
  component: WrongApp,
})

/** A Technician or Guard who signs in here has a valid session and sees only this page (DR-174, UIWO-05). */
function WrongApp() {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const config = useQuery(publicConfigQuery()).data
  useQuery(staffMeQuery())
  const stores = config?.apps.staff.storeUrl
  return (
    <PublicLayout>
      <Card className="flex flex-col items-center gap-5 p-8 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-teal-soft text-on-teal-soft">
          <Icon name="phone" size="lg" weight="fill" />
        </span>
        <h1 className="text-title-1 text-ink">{t('web.wrong-app.title')}</h1>
        <p className="text-body text-ink-muted">{t('web.wrong-app.body')}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {stores?.ios && (
            <a href={stores.ios} className={buttonStyles({ variant: 'outline' })} rel="noreferrer">
              {t('web.wrong-app.cta.ios')}
            </a>
          )}
          {stores?.android && (
            <a
              href={stores.android}
              className={buttonStyles({ variant: 'outline' })}
              rel="noreferrer"
            >
              {t('web.wrong-app.cta.android')}
            </a>
          )}
        </div>
        <Button variant="ghost" onClick={() => void signOut(queryClient, 'user')}>
          {t('web.wrong-app.cta.signout')}
        </Button>
      </Card>
    </PublicLayout>
  )
}
