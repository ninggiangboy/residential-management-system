import { apiErrorOf, RESEND_AFTER_SECONDS } from '@rms/client-core'
import { useCountdown, useI18n, useOnline } from '@rms/mobile-core'
import { Banner, Button, EmptyState, Screen, Text } from '@rms/ui-native'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useStaffPasswordReset } from '../../src/api/hooks'
import { emailDraft, maskEmail } from '../../src/features/email-draft'

/** `S-Forgot-Sent` (DOC-61): neutral text with the masked address; the resend is enabled 45 s after each send (DR-208). */
export default function ForgotSent() {
  const i18n = useI18n()
  const { t } = i18n
  const router = useRouter()
  const online = useOnline()
  const reset = useStaffPasswordReset()
  const [until, setUntil] = useState(() => performance.now() + RESEND_AFTER_SECONDS * 1000)
  const [error, setError] = useState<string | null>(null)
  const left = useCountdown(until)

  const resend = () =>
    reset.mutate(emailDraft.get(), {
      onSuccess: () => {
        setError(null)
        setUntil(performance.now() + RESEND_AFTER_SECONDS * 1000)
      },
      onError: (thrown) => {
        const failure = apiErrorOf(thrown)
        if (failure.code === 'rate_limited')
          setUntil(performance.now() + (failure.retryAfter ?? 60) * 1000)
        setError(
          failure.code === 'network' ? t('common.network.not-sent') : i18n.errorText(failure),
        )
      },
    })

  return (
    <Screen
      testID="forgot-sent-screen"
      footer={
        <>
          <Button
            block
            testID="forgot-resend"
            loading={reset.isPending}
            disabled={left > 0 || !online}
            onPress={resend}
          >
            {t('staff.forgot-sent.cta.resend')}
          </Button>
          <Button block variant="ghost" testID="forgot-back" onPress={() => router.replace('/')}>
            {t('staff.forgot-sent.cta.back')}
          </Button>
        </>
      }
    >
      <EmptyState
        icon="check-circle"
        title={t('staff.forgot-sent.title')}
        body={t('staff.forgot-sent.body', { maskedEmail: maskEmail(emailDraft.get()) })}
      />
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {left > 0 ? (
        <Text variant="secondary" tone="muted" className="text-center">
          {t('staff.forgot-sent.resend-in', { seconds: left })}
        </Text>
      ) : null}
    </Screen>
  )
}
