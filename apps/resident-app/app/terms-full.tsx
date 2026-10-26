import { useI18n } from '@rms/mobile-core'
import { Screen, Skeleton, TermsView, Text, TopBar } from '@rms/ui-native'
import { useRouter } from 'expo-router'
import { View } from 'react-native'
import { useTerms } from '../src/api/hooks'

/** The binding text of E-16 in a full-screen reader; Back returns with the checkbox of the caller kept (UIRA-27). */
export default function TermsFull() {
  const { t } = useI18n()
  const router = useRouter()
  const terms = useTerms()
  return (
    <Screen
      testID="terms-full"
      header={
        <TopBar
          title={t('res.terms.action.read-full')}
          backLabel={t('common.action.back')}
          onBack={() => router.back()}
        />
      }
    >
      {terms.isPending ? <Skeleton className="h-40 w-full" /> : null}
      {terms.data?.items.map((item) => (
        <View key={item.versionId} className="gap-3">
          <Text variant="caption" tone="muted">
            {t(
              item.kind === 'privacy'
                ? 'res.terms-update.item.privacy'
                : 'res.terms-update.item.terms',
              {
                version: item.version,
              },
            )}
          </Text>
          <TermsView text={item.text} />
        </View>
      ))}
    </Screen>
  )
}
