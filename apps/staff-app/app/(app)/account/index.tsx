import { apiErrorOf } from '@rms/client-core'
import {
  buildingName,
  pushPermission,
  requestPushToken,
  useI18n,
  useOnline,
  useRuntime,
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
  Tag,
  Text,
  TextField,
  TopBar,
} from '@rms/ui-native'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Linking, View } from 'react-native'
import { useConfig, useStaffMe, useUpdateStaffMe } from '../../../src/api/hooks'
import { env } from '../../../src/runtime'

/** `S-Account` (DOC-61): profile, building, language and push, the password note, the sessions and the sign-out. */
export default function StaffAccount() {
  const i18n = useI18n()
  const { t, lang } = i18n
  const router = useRouter()
  const online = useOnline()
  const { session } = useRuntime()
  const me = useStaffMe()
  const config = useConfig()
  const update = useUpdateStaffMe()
  const [languageOpen, setLanguageOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [signOutOpen, setSignOutOpen] = useState(false)
  const [deniedOpen, setDeniedOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const profile = me.data
  const building = buildingName(config.data?.contact, lang)

  const save = (
    body: { fullName?: string; language?: 'vi' | 'en'; pushEnabled?: boolean },
    onDone?: () => void,
  ) => {
    if (!profile) return
    update.mutate(
      { version: profile.version, body },
      {
        onSuccess: () => onDone?.(),
        onError: (thrown) => setError(i18n.errorText(apiErrorOf(thrown))),
      },
    )
  }

  const pickLanguage = (next: 'vi' | 'en') => {
    setLanguageOpen(false)
    if (next === lang) return
    // The catalog switches at once; a failed save reverts it (DOC-61 §6).
    i18n.setLang(next)
    if (!profile) return
    update.mutate(
      { version: profile.version, body: { language: next } },
      {
        onError: (thrown) => {
          i18n.setLang(lang)
          setError(i18n.errorText(apiErrorOf(thrown)))
        },
      },
    )
  }

  const togglePush = async (next: boolean) => {
    setError(null)
    if (!next) return save({ pushEnabled: false })
    if ((await pushPermission()) === 'denied') return setDeniedOpen(true)
    const result = await requestPushToken()
    if (result.status === 'denied') return setDeniedOpen(true)
    // A simulator has no token (`no_device`); the setting is still saved, the registration waits for E-34.
    save({ pushEnabled: true })
  }

  const saveName = () => {
    const trimmed = name.normalize('NFC').trim()
    if (trimmed.length < 1 || trimmed.length > 120)
      return setNameError(t('staff.login.field.email.error.required'))
    setNameError(null)
    save({ fullName: trimmed }, () => setEditOpen(false))
  }

  return (
    <Screen
      testID="staff-account-screen"
      header={<TopBar large title={t('staff.account.title')} />}
    >
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {!online ? <Banner tone="warning">{t('offline.banner')}</Banner> : null}
      {profile ? (
        <View className="flex-row items-center gap-4">
          <Avatar name={profile.fullName} size="lg" />
          <View className="flex-1 gap-1">
            <Text variant="title-3" testID="staff-name">
              {profile.fullName}
            </Text>
            <Text variant="secondary" tone="muted">
              {profile.email}
            </Text>
            <Tag tone="info">
              {t(`common.staff-role.${profile.role}` as 'common.staff-role.admin')}
            </Tag>
          </View>
          <Button
            variant="ghost"
            size="sm"
            testID="edit-profile"
            disabled={!online}
            onPress={() => {
              setName(profile.fullName)
              setNameError(null)
              setEditOpen(true)
            }}
          >
            {t('common.action.edit')}
          </Button>
        </View>
      ) : null}

      {building ? (
        <List>
          <ListItem icon="buildings" title={building} />
        </List>
      ) : null}

      <List title={t('staff.account.settings.title')}>
        <ListItem
          testID="account-language"
          icon="gear"
          title={t('staff.account.language.label')}
          value={t(lang === 'vi' ? 'common.language.switch-to-vi' : 'common.language.switch-to-en')}
          disabled={!online}
          onPress={() => setLanguageOpen(true)}
        />
        <ListItem
          icon="bell"
          title={t('staff.account.push.label')}
          subtitle={t('staff.account.push.hint')}
          trailing={
            <Switch
              testID="account-push"
              label={t('staff.account.push.label')}
              value={profile?.pushEnabled ?? false}
              disabled={!online || !profile}
              onValueChange={(next) => void togglePush(next)}
            />
          }
        />
        <ListItem
          testID="account-sessions"
          icon="lock"
          title={t('staff.account.sessions.label')}
          onPress={() => router.push('/account/sessions')}
        />
      </List>

      {profile ? (
        <Banner tone="neutral" title={t('staff.account.password.title')}>
          {t('staff.account.password.note', { email: profile.email })}
        </Banner>
      ) : null}

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
        {t('staff.account.signout.cta')}
      </Button>

      <BottomSheet
        visible={languageOpen}
        onClose={() => setLanguageOpen(false)}
        title={t('staff.account.language.label')}
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
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        title={t('staff.account.edit.title')}
        closeLabel={t('common.action.close')}
        actions={
          <Button block testID="save-profile" loading={update.isPending} onPress={saveName}>
            {t('common.action.save')}
          </Button>
        }
      >
        <TextField
          testID="name-input"
          label={t('staff.account.field.name.label')}
          value={name}
          onChangeText={setName}
          error={nameError ?? undefined}
        />
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
          {t('staff.account.push.hint')}
        </Text>
      </BottomSheet>

      <Dialog
        visible={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        title={t('staff.account.signout.dialog.title')}
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
              {t('staff.account.signout.cta')}
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
