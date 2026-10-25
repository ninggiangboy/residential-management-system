import { staffKey } from '@rms/client-core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../../api/client'
import { apiErrorOf, unwrap, unwrapEmpty } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { CardSection } from '../../components/ui/card'
import { ConfirmDialog } from '../../components/ui/dialog'
import { Icon } from '../../components/ui/icon'
import { Skeleton } from '../../components/ui/skeleton'
import { Tag } from '../../components/ui/tag'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { useCanWrite } from '../../lib/online'

const sessionsKey = staffKey('sessions')

/** E-32 and E-33: the live sessions of the member, with the current one marked and every other one endable (N9, FR-45.1). */
export function SessionsCard() {
  const { t, formatDateTime } = useI18n()
  const queryClient = useQueryClient()
  const canWrite = useCanWrite()
  const [ending, setEnding] = useState<string | null>(null)
  const sessions = useQuery({
    queryKey: sessionsKey,
    queryFn: async () => unwrap(await api.staff.sessions.get()).items,
  })
  const revoke = useMutation({
    mutationFn: async (id: string) => unwrapEmpty(await api.staff.sessions({ id }).delete()),
    onSuccess: () => toast.success(t('web.profile.dialog.revoke.confirm')),
    onError: (thrown) => {
      // 404: the session is already gone; the list refetches either way (DOC-64 `W-Profile` §6).
      if (apiErrorOf(thrown).status !== 404) toast.error(errorText(t, apiErrorOf(thrown)))
    },
    onSettled: () => {
      setEnding(null)
      void queryClient.invalidateQueries({ queryKey: sessionsKey })
    },
  })

  return (
    <CardSection title={t('web.profile.card.sessions.title')}>
      {sessions.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : sessions.isError ? (
        <Banner
          tone="warning"
          actions={
            <Button size="sm" variant="outline" onClick={() => void sessions.refetch()}>
              {t('common.action.retry')}
            </Button>
          }
        >
          {t('common.error.page.body')}
        </Banner>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {sessions.data.map((session) => (
            <li key={session.id} className="flex items-center gap-4 py-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-fill text-ink-muted">
                <Icon name={session.client === 'web' ? 'squares-four' : 'phone'} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-strong text-ink">{session.device}</p>
                <p className="text-secondary text-ink-muted">
                  {t(`web.profile.session.client.${session.client}`)} ·{' '}
                  {formatDateTime(session.lastUsedAt)}
                </p>
              </div>
              {session.current ? (
                <Tag tone="success">{t('web.profile.session.current')}</Tag>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canWrite}
                  onClick={() => setEnding(session.id)}
                >
                  {t('web.profile.session.cta')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={ending !== null}
        onOpenChange={(open) => !open && setEnding(null)}
        title={t('web.profile.dialog.revoke.title')}
        body={t('web.profile.dialog.revoke.body')}
        confirmLabel={t('web.profile.dialog.revoke.confirm')}
        loading={revoke.isPending}
        onConfirm={() => ending && revoke.mutate(ending)}
      />
    </CardSection>
  )
}
