import { buildingName, hoursOf, telUrl, useI18n } from '@rms/mobile-core'
import { Button, List, ListItem, Plate, Screen, Skeleton, Text, TopBar } from '@rms/ui-native'
import { useRouter } from 'expo-router'
import { Linking, View } from 'react-native'
import { useContact } from '../src/api/hooks'

/** `Contact` (DOC-60): the office's hotline, hours and email from E-15, in the account language. A `null` line hides its row. */
export default function Contact() {
  const i18n = useI18n()
  const { t, lang } = i18n
  const router = useRouter()
  const contact = useContact()
  const data = contact.data
  const hours = hoursOf(data, lang)
  const name = buildingName(data, lang)
  const initials = (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <Screen
      testID="contact-screen"
      header={
        <TopBar
          title={t('res.contact.title')}
          backLabel={t('common.action.back')}
          onBack={() => router.back()}
        />
      }
      footer={
        data?.hotline ? (
          <Button
            block
            icon="phone"
            onPress={() => void Linking.openURL(telUrl(data.hotline as string))}
          >
            {t('res.contact.cta')}
          </Button>
        ) : null
      }
    >
      {contact.isPending ? <Skeleton className="h-24 w-full" /> : null}
      {data ? (
        <>
          <View className="gap-2">
            {initials ? <Plate size="lg">{initials}</Plate> : null}
            <Text variant="title-2">{name}</Text>
          </View>
          <List>
            {data.hotline ? (
              <ListItem
                key="hotline"
                icon="phone"
                title={t('res.contact.hotline')}
                subtitle={data.hotline}
                onPress={() => void Linking.openURL(telUrl(data.hotline as string))}
              />
            ) : null}
            {hours ? (
              <ListItem key="hours" icon="clock" title={t('res.contact.hours')} subtitle={hours} />
            ) : null}
            {data.email ? (
              <ListItem
                key="email"
                icon="chat-circle-dots"
                title={t('res.contact.email')}
                subtitle={data.email}
                onPress={() => void Linking.openURL(`mailto:${data.email}`)}
              />
            ) : null}
          </List>
        </>
      ) : null}
    </Screen>
  )
}
