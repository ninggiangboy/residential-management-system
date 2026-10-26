import { useT } from '@rms/mobile-core'
import { UpgradeScreen as View } from '@rms/ui-native'
import { Linking, Platform } from 'react-native'

export function UpgradeScreen({ storeUrl }: { storeUrl: string | null }) {
  const t = useT()
  return (
    <View
      title={t('upgrade.title')}
      body={t('upgrade.body')}
      cta={t(Platform.OS === 'ios' ? 'upgrade.cta.ios' : 'upgrade.cta.android')}
      onUpdate={storeUrl ? () => void Linking.openURL(storeUrl) : null}
    />
  )
}
