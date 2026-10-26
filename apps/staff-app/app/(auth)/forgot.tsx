import { apiErrorOf } from '@rms/client-core'
import { useCountdown, useI18n, useOnline } from '@rms/mobile-core'
import { Banner, Button, Screen, TextField, TopBar } from '@rms/ui-native'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { useStaffPasswordReset } from '../../src/api/hooks'
import { emailDraft } from '../../src/features/email-draft'

/** `S-Forgot` (DOC-61): E-06 answers 202 for every email, so the next screen never says whether the account exists (FR-13.4). */
export default function Forgot() {
  const i18n = useI18n()
  const { t } = i18n
  const router = useRouter()
  const online = useOnline()
  const reset = useStaffPasswordReset()
  const [email, setEmail] = useState(emailDraft.get())
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [until, setUntil] = useState<number | null>(null)
  const left = useCountdown(until)

  const submit = () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim()))
      return setFieldError(
        t(
          email.trim()
            ? 'staff.login.field.email.error.invalid'
            : 'staff.login.field.email.error.required',
        ),
      )
    setFieldError(null)
    setBanner(null)
    emailDraft.set(email.trim())
    reset.mutate(email.trim(), {
      onSuccess: () => router.replace('/forgot-sent'),
      onError: (thrown) => {
        const error = apiErrorOf(thrown)
        if (error.code === 'rate_limited')
          setUntil(performance.now() + (error.retryAfter ?? 60) * 1000)
        if (error.code === 'validation_failed')
          return setFieldError(t('staff.login.field.email.error.invalid'))
        setBanner(error.code === 'network' ? t('common.network.not-sent') : i18n.errorText(error))
      },
    })
  }

  return (
    <Screen
      testID="forgot-screen"
      header={
        <TopBar
          large
          title={t('staff.forgot.title')}
          subtitle={t('staff.forgot.subtitle')}
          backLabel={t('common.action.back')}
          onBack={() => router.back()}
        />
      }
      footer={
        <Button
          block
          testID="forgot-submit"
          loading={reset.isPending}
          disabled={!online || left > 0}
          onPress={submit}
        >
          {left > 0 ? t('common.retry-in', { seconds: left }) : t('staff.forgot.cta')}
        </Button>
      }
    >
      {!online ? <Banner tone="warning">{t('offline.banner')}</Banner> : null}
      {banner ? <Banner tone="danger">{banner}</Banner> : null}
      <TextField
        testID="forgot-email"
        label={t('staff.forgot.field.email.label')}
        hint={t('staff.forgot.field.email.hint')}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        value={email}
        onChangeText={setEmail}
        error={fieldError ?? undefined}
      />
      <Banner tone="neutral" title={t('staff.forgot.banner.title')}>
        {t('staff.forgot.banner.body')}
      </Banner>
    </Screen>
  )
}
