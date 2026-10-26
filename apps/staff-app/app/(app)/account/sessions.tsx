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
import { useRevokeStaffSession, useStaffSessions } from '../../../src/api/hooks'

/** The sessions view of `S-Account` (DOC-61): the live sessions with the device, the last use and a revoke on the others. */
export default function StaffSessions() {
  const i18n = useI18n()
  const { t } = i18n
  const router = useRouter()
  const online = useOnline()
  const sessions = useStaffSessions()
  const revoke = useRevokeStaffSession()
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
          title={t('staff.account.sessions.title')}
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
        currentLabel={t('staff.account.sessions.current')}
        revokeLabel={t('staff.account.sessions.revoke')}
        disabled={!online}
        onRevoke={setTarget}
      />
      <Dialog
        visible={target !== null}
        onClose={() => setTarget(null)}
        title={t('res.sessions.dialog.title')}
        actions={
          <>
            <Button
              block
              variant="danger"
              testID="revoke-confirm"
              loading={revoke.isPending}
              onPress={() => {
                if (target) revoke.mutate(target.id, { onSettled: () => setTarget(null) })
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
