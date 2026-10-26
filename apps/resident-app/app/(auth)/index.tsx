import { apiErrorOf } from '@rms/client-core'
import { buildingName, hoursOf, telUrl, useCountdown, useI18n, useOnline } from '@rms/mobile-core'
import { Banner, Button, List, ListItem, Screen, Text, TextField } from '@rms/ui-native'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Linking, View } from 'react-native'
import { useConfig, useRequestOtp } from '../../src/api/hooks'
import { challengeStore } from '../../src/features/otp-challenge'

/** `Login` and its error states (DOC-57): the phone, then E-09. Spaces are stripped before sending (DOC-57 §4). */
type Problem =
  | { kind: 'required' }
  | { kind: 'invalid' }
  | { kind: 'not_registered' }
  | { kind: 'banner'; text: string; showContact: boolean }
  | { kind: 'rate_limited' }

export default function Login() {
  const i18n = useI18n()
  const { t, lang } = i18n
  const router = useRouter()
  const online = useOnline()
  const config = useConfig()
  const request = useRequestOtp()
  const [phone, setPhone] = useState(challengeStore.typedPhone())
  const [problem, setProblem] = useState<Problem | null>(null)
  const [retryDeadline, setRetryDeadline] = useState<number | null>(null)
  const retryLeft = useCountdown(retryDeadline)

  const contact = config.data?.contact
  const hotline = contact?.hotline ?? null
  const hours = hoursOf(contact, lang)

  const submit = () => {
    const sent = phone.replace(/\s+/g, '')
    if (sent.replace(/\D/g, '').length < 9) return setProblem({ kind: 'required' })
    setProblem(null)
    request.mutate(sent, {
      onSuccess: (answer) => {
        challengeStore.set({
          phone,
          challengeId: answer.challengeId,
          resendAfter: answer.resendAfter,
          expiresIn: answer.expiresIn,
        })
        router.push('/otp')
      },
      onError: (thrown) => {
        const error = apiErrorOf(thrown)
        if (error.code === 'phone_not_registered') return setProblem({ kind: 'not_registered' })
        if (error.code === 'validation_failed') return setProblem({ kind: 'invalid' })
        if (error.code === 'rate_limited') {
          setRetryDeadline(performance.now() + (error.retryAfter ?? 60) * 1000)
          return setProblem({ kind: 'rate_limited' })
        }
        // `sms_unavailable` and `maintenance` keep the contact row, so a resident without a code still has a number (DOC-57).
        const showContact = error.code === 'sms_unavailable' || error.code === 'maintenance'
        const text = error.code === 'network' ? t('common.network.not-sent') : i18n.errorText(error)
        setProblem({ kind: 'banner', text, showContact })
      },
    })
  }

  const fieldError =
    problem?.kind === 'required'
      ? t('res.login.field.phone.error.required')
      : problem?.kind === 'invalid'
        ? t('res.login.field.phone.error.invalid')
        : problem?.kind === 'not_registered'
          ? t('res.login-error.field.phone.error')
          : undefined
  const showContact =
    hotline &&
    (problem?.kind === 'not_registered' || (problem?.kind === 'banner' && problem.showContact))
  const waiting = retryLeft > 0

  return (
    <Screen
      testID="login-screen"
      footer={
        <>
          <Button
            block
            testID="login-submit"
            loading={request.isPending}
            disabled={!online || waiting}
            onPress={submit}
          >
            {waiting ? t('res.login.retry-in', { seconds: retryLeft }) : t('res.login.cta')}
          </Button>
          <Text variant="secondary" tone="muted">
            {hotline ? t('res.login.help', { hotline }) : t('res.login.help-no-hotline')}
          </Text>
        </>
      }
    >
      <View className="flex-row items-center justify-between">
        <Text variant="title-3">{t('common.app.name')}</Text>
        <Button
          variant="ghost"
          size="sm"
          testID="language-switch"
          onPress={() => i18n.setLang(lang === 'vi' ? 'en' : 'vi')}
        >
          {t(lang === 'vi' ? 'common.language.switch-to-en' : 'common.language.switch-to-vi')}
        </Button>
      </View>
      <View className="gap-2">
        {buildingName(contact, lang) ? (
          <Text variant="caption" tone="muted">
            {buildingName(contact, lang)}
          </Text>
        ) : null}
        <Text variant="title-1" accessibilityRole="header">
          {t('res.login.title')}
        </Text>
        <Text variant="body" tone="muted">
          {t('res.login.subtitle')}
        </Text>
      </View>
      {!online ? <Banner tone="warning">{t('offline.banner')}</Banner> : null}
      {problem?.kind === 'banner' ? <Banner tone="danger">{problem.text}</Banner> : null}
      {problem?.kind === 'rate_limited' ? (
        <Banner tone="danger">{i18n.errorText({ code: 'rate_limited', message: '' })}</Banner>
      ) : null}
      <TextField
        testID="phone-input"
        label={t('res.login.field.phone.label')}
        placeholder={t('res.login.field.phone.placeholder')}
        icon="phone"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        value={phone}
        onChangeText={(value) => {
          setPhone(value)
          if (problem && problem.kind !== 'rate_limited') setProblem(null)
        }}
        error={fieldError}
      />
      {showContact && hotline ? (
        <List>
          <ListItem
            testID="call-office"
            icon="phone"
            title={t('res.login-error.contact.title')}
            subtitle={t('res.login-error.contact.subtitle', { hotline, hours: hours ?? '' })}
            onPress={() => void Linking.openURL(telUrl(hotline))}
          />
        </List>
      ) : null}
    </Screen>
  )
}
