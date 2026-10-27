import { apiErrorOf } from '@rms/client-core'
import { buildingName, useCountdown, useI18n, useOnline } from '@rms/mobile-core'
import { Banner, Button, Screen, Text, TextField } from '@rms/ui-native'
import { useRouter } from 'expo-router'
import { type ComponentRef, useRef, useState } from 'react'
import { type TextInput, View } from 'react-native'
import { useConfig, useStaffLogin } from '../../src/api/hooks'
import { emailDraft } from '../../src/features/email-draft'

/** `S-Login` and its error states (DOC-61): E-05 with `client: "app"`. No state shows a count of tries left (DR-128, DR-206). */
type Problem =
  | { kind: 'fields'; email?: string; password?: string }
  | { kind: 'credentials' }
  | { kind: 'locked' }
  | { kind: 'banner'; text: string }

export default function Login() {
  const i18n = useI18n()
  const { t, lang } = i18n
  const router = useRouter()
  const online = useOnline()
  const config = useConfig()
  const login = useStaffLogin()
  const [email, setEmail] = useState(emailDraft.get())
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const passwordInput = useRef<ComponentRef<typeof TextInput>>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [until, setUntil] = useState<number | null>(null)
  const left = useCountdown(until)

  const submit = () => {
    const fields: Problem & { kind: 'fields' } = { kind: 'fields' }
    if (!email.trim()) fields.email = t('staff.login.field.email.error.required')
    else if (!/^\S+@\S+\.\S+$/.test(email.trim()))
      fields.email = t('staff.login.field.email.error.invalid')
    if (!password) fields.password = t('staff.login.field.password.error.required')
    if (fields.email || fields.password) return setProblem(fields)
    setProblem(null)
    emailDraft.set(email.trim())
    login.mutate(
      { email: email.trim(), password },
      {
        onError: (thrown) => {
          const error = apiErrorOf(thrown)
          if (error.code === 'invalid_credentials') return setProblem({ kind: 'credentials' })
          if (error.code === 'account_locked') {
            const seconds = Number(
              (error.details as { retryAfter?: number } | undefined)?.retryAfter ??
                error.retryAfter ??
                60,
            )
            setUntil(performance.now() + seconds * 1000)
            return setProblem({ kind: 'locked' })
          }
          if (error.code === 'rate_limited')
            setUntil(performance.now() + (error.retryAfter ?? 60) * 1000)
          setProblem({
            kind: 'banner',
            text: error.code === 'network' ? t('common.network.not-sent') : i18n.errorText(error),
          })
        },
      },
    )
  }

  const minutes = Math.max(1, Math.ceil(left / 60))
  const locked = left > 0
  const name = buildingName(config.data?.contact, lang)

  return (
    <Screen
      testID="login-screen"
      footer={
        <>
          <Button
            block
            testID="login-submit"
            loading={login.isPending}
            disabled={!online || locked}
            onPress={submit}
          >
            {t('staff.login.cta')}
          </Button>
          <Button
            block
            variant="ghost"
            testID="login-forgot"
            onPress={() => {
              emailDraft.set(email.trim())
              router.push('/forgot')
            }}
          >
            {t('staff.login.cta.forgot')}
          </Button>
          <Text variant="caption" tone="muted">
            {t('staff.login.note')}
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
          {t('staff.login.language')}
        </Button>
      </View>
      <View className="gap-2">
        {name ? (
          <Text variant="caption" tone="muted">
            {t('staff.login.context', { buildingName: name })}
          </Text>
        ) : null}
        <Text variant="title-1" accessibilityRole="header">
          {t('staff.login.title')}
        </Text>
        <Text variant="body" tone="muted">
          {t('staff.login.subtitle')}
        </Text>
      </View>
      {!online ? <Banner tone="warning">{t('offline.banner')}</Banner> : null}
      {problem?.kind === 'credentials' ? (
        <Banner tone="warning" title={t('staff.login.banner.policy.title')}>
          {t('staff.login.banner.policy.body')}
        </Banner>
      ) : null}
      {problem?.kind === 'locked' && locked ? (
        <Banner tone="danger" testID="locked-banner">
          {t('staff.login.banner.locked', { minutes })}
        </Banner>
      ) : null}
      {problem?.kind === 'banner' ? <Banner tone="danger">{problem.text}</Banner> : null}
      <TextField
        testID="email-input"
        label={t('staff.login.field.email.label')}
        placeholder={t('staff.login.field.email.placeholder')}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="username"
        autoComplete="email"
        returnKeyType="next"
        // The keyboard covers most of the form, so "Next" moves to the password the way a tap on it would.
        submitBehavior="submit"
        onSubmitEditing={() => passwordInput.current?.focus()}
        value={email}
        onChangeText={setEmail}
        error={problem?.kind === 'fields' ? problem.email : undefined}
      />
      <TextField
        ref={passwordInput}
        testID="password-input"
        label={t('staff.login.field.password.label')}
        secureTextEntry={!reveal}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
        autoComplete="current-password"
        returnKeyType="go"
        // Enter on the keyboard signs in like the button does, which the keyboard may cover.
        onSubmitEditing={() => {
          if (online && !locked && !login.isPending) submit()
        }}
        value={password}
        onChangeText={setPassword}
        suffix={{
          label: t(reveal ? 'staff.login.field.password.hide' : 'staff.login.field.password.show'),
          onPress: () => setReveal(!reveal),
        }}
        error={
          problem?.kind === 'credentials'
            ? t('staff.login.field.password.error')
            : problem?.kind === 'fields'
              ? problem.password
              : undefined
        }
      />
    </Screen>
  )
}
