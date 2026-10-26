import { apiErrorOf } from '@rms/client-core'
import { useI18n, useOnline, useRuntime } from '@rms/mobile-core'
import { Banner, Button, Checkbox, List, ListItem, Screen, Skeleton, TopBar } from '@rms/ui-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { useAcceptTerms, useTerms } from '../src/api/hooks'

/**
 * `Terms` (first sign-in) and `Terms-Update` (the gate of a 403 `terms_required`): one route and one component, told apart by
 * `mode` (DOC-57). One checkbox accepts every listed unaccepted version; it starts unticked (FR-39.1).
 */
export default function Terms() {
  const i18n = useI18n()
  const { t } = i18n
  const router = useRouter()
  const online = useOnline()
  const { termsGate, session } = useRuntime()
  const { mode } = useLocalSearchParams<{ mode?: string }>()
  const update = mode === 'update'
  const terms = useTerms()
  const accept = useAcceptTerms()
  const [agreed, setAgreed] = useState(false)
  const [superseded, setSuperseded] = useState(false)

  const pending = terms.data?.items.filter((item) => !item.accepted) ?? []
  const prefix = update ? 'res.terms-update' : 'res.terms'

  const submit = () =>
    accept.mutate(
      pending.map((item) => item.versionId),
      {
        // The gate resolves and the fetcher replays the interrupted call once (UIRA-28).
        onSuccess: () => termsGate.resolve(),
        onError: (thrown) => {
          if (apiErrorOf(thrown).code === 'terms_version_superseded') {
            setAgreed(false)
            setSuperseded(true)
            void terms.refetch()
          }
        },
      },
    )

  return (
    <Screen
      testID="terms-screen"
      header={
        <TopBar
          large
          title={t(`${prefix}.title` as 'res.terms.title')}
          subtitle={update ? undefined : t('res.terms.subtitle')}
        />
      }
      footer={
        <>
          <Checkbox
            testID="terms-consent"
            checked={agreed}
            onChange={setAgreed}
            label={t(`${prefix}.consent` as 'res.terms.consent')}
            disabled={pending.length === 0}
          />
          <Button
            block
            testID="terms-accept"
            loading={accept.isPending}
            disabled={!agreed || pending.length === 0 || !online}
            onPress={submit}
          >
            {t(`${prefix}.cta` as 'res.terms.cta')}
          </Button>
          {update ? (
            <Button block variant="ghost" onPress={() => void session.signOut()}>
              {t('res.terms-update.sign-out')}
            </Button>
          ) : null}
        </>
      }
    >
      {superseded ? <Banner tone="warning">{t('res.terms.superseded')}</Banner> : null}
      {accept.isError && !superseded ? (
        <Banner tone="danger">{i18n.errorText(apiErrorOf(accept.error))}</Banner>
      ) : null}
      {terms.isPending ? (
        <View className="gap-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </View>
      ) : update ? (
        <List title={t('res.terms-update.changed')}>
          {pending.map((item) => (
            <ListItem
              key={item.versionId}
              icon="file-text"
              title={t(
                item.kind === 'privacy'
                  ? 'res.terms-update.item.privacy'
                  : 'res.terms-update.item.terms',
                {
                  version: item.version,
                },
              )}
            />
          ))}
        </List>
      ) : (
        <List title={t('res.terms.intro')}>
          <ListItem
            icon="user-circle"
            title={t('res.terms.item.personal.title')}
            subtitle={t('res.terms.item.personal.body')}
          />
          <ListItem
            icon="bell"
            title={t('res.terms.item.push.title')}
            subtitle={t('res.terms.item.push.body')}
          />
          <ListItem
            icon="image"
            title={t('res.terms.item.photos.title')}
            subtitle={t('res.terms.item.photos.body')}
          />
          <ListItem
            icon="trash"
            title={t('res.terms.item.deletion.title')}
            subtitle={t('res.terms.item.deletion.body')}
          />
        </List>
      )}
      <Button variant="ghost" testID="terms-read" onPress={() => router.push('/terms-full')}>
        {t('res.terms.action.read-full')}
      </Button>
    </Screen>
  )
}
