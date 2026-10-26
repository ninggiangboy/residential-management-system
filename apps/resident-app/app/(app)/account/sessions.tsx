import { apiErrorOf } from '@rms/client-core'
import { useI18n, useOnline } from '@rms/mobile-core'
import {
  Banner,
  Button,
  Dialog,
  Screen,
  SessionList,
  type SessionRow,
  Skeleton,
  TopBar,
} from '@rms/ui-native'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useRevokeSession, useSessions } from '../../../src/api/hooks'

/** `Sessions` (DOC-60): the live sessions, at most 10; revoking another ends it, revoking this one is a sign-out. */
export default function Sessions() {
  const i18n = useI18n()
  const { t } = i18n
  const router = useRouter()
  const online = useOnline()
  const sessions = useSessions()
  const revoke = useRevokeSession()
  const [target, setTarget] = useState<SessionRow | null>(null)

  const rows: SessionRow[] = (sessions.data?.items ?? []).map((item) => ({
    id: item.id,
    title: item.device,
    subtitle: t('res.sessions.last-used', { lastUsedAt: i18n.formatDateTime(item.lastUsedAt) }),
    current: item.current,
  }))

  return (
    <Screen
      testID="sessions-screen"
      header={
        <TopBar
          title={t('res.sessions.title')}
          backLabel={t('common.action.back')}
          onBack={() => router.back()}
        />
      }
    >
      {!online ? <Banner tone="warning">{t('offline.action_disabled')}</Banner> : null}
      {sessions.isError ? (
        <Banner tone="danger">{i18n.errorText(apiErrorOf(sessions.error))}</Banner>
      ) : null}
      {sessions.isPending ? <Skeleton className="h-24 w-full" /> : null}
      <SessionList
        rows={rows}
        currentLabel={t('res.sessions.current')}
        revokeLabel={t('res.sessions.action.revoke')}
        disabled={!online}
        onRevoke={setTarget}
      />
      <Dialog
        visible={target !== null}
        onClose={() => setTarget(null)}
        title={t('res.sessions.dialog.title')}
        body={t('res.sessions.dialog.body')}
        actions={
          <>
            <Button
              block
              variant="danger"
              testID="revoke-confirm"
              loading={revoke.isPending}
              onPress={() => {
                const row = target
                if (!row) return
                revoke.mutate(row.id, { onSettled: () => setTarget(null) })
              }}
            >
              {t('res.sessions.dialog.confirm')}
            </Button>
            <Button block variant="ghost" onPress={() => setTarget(null)}>
              {t('common.action.cancel')}
            </Button>
          </>
        }
      />
    </Screen>
  )
}
