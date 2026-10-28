import { apiErrorOf } from '@rms/client-core'
import {
  pushPermission,
  requestPushToken,
  trackTap,
  useI18n,
  useOnline,
  useRuntime,
  useSelectedUnitId,
  useUsageEnabled,
} from '@rms/mobile-core'
import {
  Avatar,
  Banner,
  BottomSheet,
  Button,
  Dialog,
  List,
  ListItem,
  Screen,
  Switch,
  Text,
  TopBar,
} from '@rms/ui-native'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Linking, View } from 'react-native'
import { useMe, useUpdateMe } from '../../../src/api/hooks'
import { env } from '../../../src/runtime'

/** `Account` (DOC-60): the profile, the homes, the language and push settings, the links and the sign-out. */
export default function Account() {
  const i18n = useI18n()
  const { t, lang } = i18n
  const router = useRouter()
  const online = useOnline()
  const { session, unit } = useRuntime()
  const unitId = useSelectedUnitId()
  const me = useMe()
  const update = useUpdateMe()
  const [usageEnabled, setUsageEnabled] = useUsageEnabled()
  const [languageOpen, setLanguageOpen] = useState(false)
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [deniedOpen, setDeniedOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const account = me.data?.account
  const memberships = me.data?.memberships ?? []

  const save = (body: { language?: 'vi' | 'en'; pushEnabled?: boolean }, onFail?: () => void) =>
    update.mutate(body, {
      onError: (thrown) => {
        setError(i18n.errorText(apiErrorOf(thrown)))
        onFail?.()
      },
    })

  const pickLanguage = (next: 'vi' | 'en') => {
    setLanguageOpen(false)
    if (next === lang) return
    // The catalog switches at once; a failed save reverts it (DOC-60 §6).
    i18n.setLang(next)
    save({ language: next }, () => i18n.setLang(lang))
  }

  const togglePush = async (next: boolean) => {
    trackTap('Account.push')
    setError(null)
    if (!next) return save({ pushEnabled: false })
    if ((await pushPermission()) === 'denied') return setDeniedOpen(true)
    const result = await requestPushToken()
    if (result.status === 'denied') return setDeniedOpen(true)
    // A simulator has no token (`no_device`); the setting is still saved, the registration waits for E-22.
    save({ pushEnabled: true })
  }

  return (
    <Screen
      testID="account-screen"
      header={
        <TopBar
          large
          title={t('res.account.title')}
          backLabel={t('common.action.back')}
          onBack={() => router.back()}
        />
      }
    >
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {!online ? <Banner tone="warning">{t('offline.banner')}</Banner> : null}
      {account ? (
        <View className="flex-row items-center gap-4">
          <Avatar name={account.displayName} size="lg" />
          <View className="flex-1">
            <Text variant="title-3">{account.displayName ?? i18n.formatPhone(account.phone)}</Text>
            <Text variant="secondary" tone="muted">
              {i18n.formatPhone(account.phone)}
            </Text>
          </View>
        </View>
      ) : null}

      <List title={t('res.account.units.title')}>
        {memberships.map((membership) => (
          <ListItem
            key={membership.unitId}
            testID={`account-unit-${membership.unitCode}`}
            icon="buildings"
            selected={membership.unitId === unitId}
            title={membership.unitCode}
            subtitle={
              `${t(`common.member-type.${membership.memberType === 'tenant' && membership.canPay ? 'tenant-pay' : membership.memberType}` as 'common.member-type.owner')}` +
              (membership.unitId === unitId ? `, ${t('res.account.unit.selected')}` : '')
            }
            onPress={() => {
              // Selecting removes the previous unit's queries before the home shows (UIRQ-02).
              unit.select(membership.unitId)
              router.dismissTo('/')
            }}
          />
        ))}
      </List>

      <List title={t('res.account.settings.title')}>
        <ListItem
          testID="account-language"
          icon="gear"
          title={t('res.account.language.label')}
          value={t(lang === 'vi' ? 'common.language.switch-to-vi' : 'common.language.switch-to-en')}
          disabled={!online}
          onPress={() => {
            trackTap('Account.language')
            setLanguageOpen(true)
          }}
        />
        <ListItem
          icon="bell"
          title={t('res.account.push.label')}
          subtitle={t('res.account.push.hint')}
          trailing={
            <Switch
              testID="account-push"
              label={t('res.account.push.label')}
              value={account?.pushEnabled ?? false}
              disabled={!online || !account}
              onValueChange={(next) => void togglePush(next)}
            />
          }
        />
        <ListItem
          icon="info"
          title={t('common.usage.title')}
          subtitle={t('common.usage.hint')}
          trailing={
            <Switch
              testID="account-usage"
              label={t('common.usage.title')}
              value={usageEnabled}
              onValueChange={setUsageEnabled}
            />
          }
        />
      </List>

      <List>
        <ListItem
          icon="headset"
          title={t('res.account.contact.label')}
          onPress={() => router.push('/contact')}
        />
        <ListItem
          testID="account-terms"
          icon="file-text"
          title={t('res.account.terms.label')}
          onPress={() => router.push('/terms-full')}
        />
        <ListItem
          testID="account-sessions"
          icon="lock"
          title={t('res.account.sessions.label')}
          onPress={() => router.push('/account/sessions')}
        />
      </List>

      {env.isProduction ? null : (
        <List>
          <ListItem
            icon="wrench"
            title="Device check"
            onPress={() => router.push('/device-check')}
          />
        </List>
      )}

      <Button
        block
        variant="outline"
        testID="sign-out"
        icon="sign-out"
        onPress={() => setSignOutOpen(true)}
      >
        {t('res.account.signout.cta')}
      </Button>

      <BottomSheet
        visible={languageOpen}
        onClose={() => setLanguageOpen(false)}
        title={t('res.account.language.label')}
        closeLabel={t('common.action.close')}
      >
        <List>
          <ListItem
            testID="language-vi"
            title={t('common.language.switch-to-vi')}
            selected={lang === 'vi'}
            onPress={() => pickLanguage('vi')}
          />
          <ListItem
            testID="language-en"
            title={t('common.language.switch-to-en')}
            selected={lang === 'en'}
            onPress={() => pickLanguage('en')}
          />
        </List>
      </BottomSheet>

      <BottomSheet
        visible={deniedOpen}
        onClose={() => setDeniedOpen(false)}
        title={t('res.account.push.denied.title')}
        closeLabel={t('common.action.close')}
        actions={
          <Button
            block
            onPress={() => {
              setDeniedOpen(false)
              void Linking.openSettings()
            }}
          >
            {t('res.account.push.denied.confirm')}
          </Button>
        }
      >
        <Text variant="body" tone="muted">
          {t('res.account.push.hint')}
        </Text>
      </BottomSheet>

      <Dialog
        visible={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        title={t('res.account.signout.dialog.title')}
        testID="signout-dialog"
        actions={
          <>
            <Button
              block
              variant="danger"
              testID="signout-confirm"
              onPress={() => {
                setSignOutOpen(false)
                void session.signOut()
              }}
            >
              {t('res.account.signout.dialog.confirm')}
            </Button>
            <Button block variant="ghost" onPress={() => setSignOutOpen(false)}>
              {t('common.action.cancel')}
            </Button>
          </>
        }
      />
    </Screen>
  )
}
