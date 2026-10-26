import { apiErrorOf } from '@rms/client-core'
import { useCountdown, useI18n, useOnline } from '@rms/mobile-core'
import { Banner, Button, OtpInput, Screen, Text, TopBar } from '@rms/ui-native'
import { Redirect, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useRequestOtp, useVerifyOtp } from '../../src/api/hooks'
import { challengeStore, useChallenge } from '../../src/features/otp-challenge'

export default function Otp() {
  const i18n = useI18n()
  const { t } = i18n
  const router = useRouter()
  const online = useOnline()
  const challenge = useChallenge()
  const verify = useVerifyOtp()
  const resend = useRequestOtp()
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [resendDeadline, setResendDeadline] = useState<number | null>(null)
  const resendLeft = useCountdown(resendDeadline ?? challenge?.resendAtMs ?? null)
  const expiresLeft = useCountdown(challenge?.expiresAtMs ?? null)
  const expired = challenge !== null && expiresLeft === 0
  // One verify per code, even when the sixth digit is delivered twice by autofill and typing (UIRA-13).
  const sending = useRef(false)

  useEffect(() => {
    if (expired) {
      setCode('')
      setMessage(t('res.otp.expired'))
    }
  }, [expired, t])

  // Without a challenge in memory the screen has nothing to show (DOC-57 `OTP` §1).
  if (!challenge) return <Redirect href="/" />

  const submit = (value: string) => {
    if (sending.current || expired) return
    sending.current = true
    setMessage(null)
    verify.mutate(
      { challengeId: challenge.challengeId, code: value },
      {
        onSuccess: () => challengeStore.clear(),
        onError: (thrown) => {
          const error = apiErrorOf(thrown)
          setCode('')
          if (error.code === 'otp_invalid') {
            const left = Number(
              (error.details as { attemptsLeft?: number } | undefined)?.attemptsLeft ?? 0,
            )
            if (left <= 0) {
              // The challenge is gone: say so and enable the resend at once (UIRA-15).
              setMessage(t('res.otp.locked'))
              setResendDeadline(performance.now())
            } else setMessage(t('res.otp.field.code.error', { attemptsLeft: left }))
          } else
            setMessage(
              error.code === 'network' ? t('common.network.not-sent') : i18n.errorText(error),
            )
        },
        onSettled: () => {
          sending.current = false
        },
      },
    )
  }

  const askAgain = () => {
    const sent = challenge.phone.replace(/\s+/g, '')
    resend.mutate(sent, {
      onSuccess: (answer) => {
        challengeStore.set({
          phone: challenge.phone,
          challengeId: answer.challengeId,
          resendAfter: answer.resendAfter,
          expiresIn: answer.expiresIn,
        })
        setResendDeadline(null)
        setCode('')
        setMessage(null)
      },
      onError: (thrown) => {
        const error = apiErrorOf(thrown)
        if (error.code === 'rate_limited')
          setResendDeadline(performance.now() + (error.retryAfter ?? 60) * 1000)
        else
          setMessage(
            error.code === 'network' ? t('common.network.not-sent') : i18n.errorText(error),
          )
      },
    })
  }

  return (
    <Screen
      testID="otp-screen"
      header={
        <TopBar
          title={t('res.otp.title')}
          backLabel={t('common.action.back')}
          onBack={() => {
            challengeStore.clear()
            router.back()
          }}
        />
      }
    >
      <Text variant="body" tone="muted">
        {t('res.otp.subtitle', { phone: challenge.phone })}
      </Text>
      {!online ? <Banner tone="warning">{t('offline.banner')}</Banner> : null}
      <OtpInput
        testID="otp-input"
        label={t('res.otp.field.code.label')}
        value={code}
        onChange={setCode}
        onComplete={submit}
        disabled={verify.isPending || expired}
        autoFocus
        error={message ?? undefined}
      />
      <View className="gap-2">
        <Button
          variant="ghost"
          testID="otp-resend"
          disabled={resendLeft > 0 || !online}
          loading={resend.isPending}
          onPress={askAgain}
        >
          {resendLeft > 0
            ? t('res.otp.action.resend-in', { seconds: resendLeft })
            : t('res.otp.action.resend')}
        </Button>
        <Button
          variant="ghost"
          testID="otp-change-phone"
          onPress={() => {
            challengeStore.clear()
            router.back()
          }}
        >
          {t('res.otp.action.change-phone')}
        </Button>
      </View>
      <Text variant="caption" tone="muted">
        {t('res.otp.footer')}
      </Text>
    </Screen>
  )
}
