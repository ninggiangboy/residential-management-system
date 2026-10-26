import { greetingKey, useI18n, useSelectedUnitId } from '@rms/mobile-core'
import { Avatar, Card, IconButton, List, ListItem, Plate, Screen, Text } from '@rms/ui-native'
import { useRouter } from 'expo-router'
import { Pressable, View } from 'react-native'
import { useMe } from '../../src/api/hooks'
import { PushPrompt } from '../../src/features/push-prompt'

/**
 * `Main` as the P1 build shows it (DOC-57 §4, UIRA-38): the greeting, the unit switcher and the shortcut "Liên hệ BQL". The cards
 * of fees, requests, notices and the QR come with their phases; there is no placeholder for them (DR-200).
 */
export default function Home() {
  const i18n = useI18n()
  const { t } = i18n
  const router = useRouter()
  const unitId = useSelectedUnitId()
  const me = useMe()
  const membership = me.data?.memberships.find((m) => m.unitId === unitId) ?? null
  const name = me.data?.account.displayName ?? null
  const several = (me.data?.memberships.length ?? 0) > 1

  return (
    <Screen testID="home-screen">
      <View className="flex-row items-center gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('res.account.title')}
          testID="open-account"
          onPress={() => router.push('/account')}
        >
          <Avatar name={name} />
        </Pressable>
        <View className="flex-1">
          <Text variant="secondary" tone="muted">
            {t(greetingKey(new Date()))}
          </Text>
          {name ? (
            <Text variant="title-3" numberOfLines={1}>
              {name}
            </Text>
          ) : null}
        </View>
        <IconButton
          icon="gear"
          label={t('res.account.title')}
          onPress={() => router.push('/account')}
        />
      </View>

      {membership ? (
        <Card
          testID="unit-switcher"
          onPress={several ? () => router.push('/unit-pick') : undefined}
          accessibilityLabel={`${membership.unitCode}. ${t('common.unit.role-line', { memberType: membership.memberType })}`}
        >
          <View className="flex-row items-center gap-3">
            <View className="flex-1 gap-2">
              <Plate size="lg">{membership.unitCode}</Plate>
              <Text variant="secondary" tone="muted">
                {t('common.unit.role-line', { memberType: membership.memberType })}
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      <List>
        <ListItem
          testID="tile-contact"
          icon="headset"
          title={t('res.main.tile.contact')}
          onPress={() => router.push('/contact')}
        />
      </List>
      <PushPrompt />
    </Screen>
  )
}
