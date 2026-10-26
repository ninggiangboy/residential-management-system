import { useI18n, useRuntime, useUnitLost } from '@rms/mobile-core'
import { Banner, Button, Card, EmptyState, Plate, Screen, Text, TopBar } from '@rms/ui-native'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { View } from 'react-native'
import { useMe } from '../src/api/hooks'

/**
 * `Unit-Pick` (DOC-57): two or more homes after sign-in, the switcher of the home, a lost home, or no home at all. A single home
 * is selected without this screen (UIRA-32). Selecting removes the previous unit's queries before the new home shows (CL-24).
 */
export default function UnitPick() {
  const i18n = useI18n()
  const { t } = i18n
  const router = useRouter()
  const { unit, session } = useRuntime()
  const queryClient = useQueryClient()
  const lost = useUnitLost()
  const me = useMe()
  const memberships = me.data?.memberships ?? []

  if (memberships.length === 0 && me.data)
    return (
      <Screen
        testID="unit-pick-none"
        header={<TopBar large title={t('res.unit-pick.title')} />}
        footer={
          <Button block variant="ghost" onPress={() => void session.signOut()}>
            {t('common.action.sign-out')}
          </Button>
        }
      >
        {lost ? <Banner tone="danger">{t('error.membership_inactive')}</Banner> : null}
        <EmptyState
          icon="buildings"
          title={t('res.unit-pick.empty.title')}
          body={t('res.unit-pick.empty.body')}
          actions={
            <Button block onPress={() => router.push('/contact')}>
              {t('res.unit-pick.action.contact')}
            </Button>
          }
        />
        <Button
          variant="ghost"
          onPress={() => void queryClient.invalidateQueries({ queryKey: ['me'] })}
        >
          {t('common.action.refresh')}
        </Button>
      </Screen>
    )

  return (
    <Screen
      testID="unit-pick"
      header={
        <TopBar
          large
          title={t('res.unit-pick.title')}
          subtitle={
            me.data
              ? t('res.unit-pick.subtitle', {
                  phone: i18n.formatPhone(me.data.account.phone),
                  count: memberships.length,
                })
              : undefined
          }
          backLabel={router.canGoBack() ? t('common.action.back') : undefined}
          onBack={() => router.back()}
        />
      }
    >
      {lost ? <Banner tone="danger">{t('error.membership_inactive')}</Banner> : null}
      <View className="gap-4">
        {memberships.map((membership) => (
          <Card
            key={membership.unitId}
            testID={`unit-${membership.unitCode}`}
            accessibilityLabel={`${membership.unitCode}, ${t(`common.member-type.${membership.memberType}` as 'common.member-type.owner')}`}
            selected={unit.get() === membership.unitId}
            onPress={() => {
              unit.select(membership.unitId)
              if (router.canGoBack()) router.back()
            }}
          >
            <View className="gap-2">
              <Plate size="lg">{membership.unitCode}</Plate>
              <Text variant="title-3">
                {t(`common.member-type.${membership.memberType}` as 'common.member-type.owner')}
              </Text>
              {membership.memberType === 'tenant' ? (
                <Text variant="secondary" tone="muted">
                  {t(
                    membership.canPay
                      ? 'res.unit-pick.card.tenant-can-pay'
                      : 'res.unit-pick.card.tenant-no-pay',
                  )}
                </Text>
              ) : null}
            </View>
          </Card>
        ))}
      </View>
      <Text variant="secondary" tone="muted">
        {t('res.unit-pick.note')}
      </Text>
    </Screen>
  )
}
