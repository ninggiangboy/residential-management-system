import {
  deviceStorage,
  readSafelySync,
  requestPushToken,
  STORAGE_KEYS,
  useT,
} from '@rms/mobile-core'
import { BottomSheet, Button, Text } from '@rms/ui-native'
import { useState } from 'react'
import { useMe, useUpdateMe } from '../api/hooks'

/**
 * The explanation sheet of the first home after sign-in (DR-199, DOC-57 `Main`): "Bật thông báo" asks the OS and, when granted,
 * saves `pushEnabled`; "Để sau" is not asked again until the resident turns push on in `Account`. The device token is registered
 * with the API (E-22) when the `notification` module serves it; until then the app holds the permission and the toggle only.
 */
export function PushPrompt() {
  const t = useT()
  const me = useMe()
  const update = useUpdateMe()
  const [open, setOpen] = useState(
    () => readSafelySync(deviceStorage, STORAGE_KEYS.pushAsked) === null,
  )
  if (!me.data) return null

  const close = () => {
    try {
      deviceStorage.setSync(STORAGE_KEYS.pushAsked, '1')
    } catch {
      // The sheet may show again at the next start.
    }
    setOpen(false)
  }

  const enable = async () => {
    const result = await requestPushToken()
    if (result.status === 'ok' && !me.data?.account.pushEnabled)
      update.mutate({ pushEnabled: true })
    close()
  }

  return (
    <BottomSheet
      visible={open}
      onClose={close}
      title={t('res.main.push.title')}
      closeLabel={t('common.action.close')}
      testID="push-sheet"
      actions={
        <>
          <Button block testID="push-enable" onPress={() => void enable()}>
            {t('res.main.push.enable')}
          </Button>
          <Button block variant="ghost" testID="push-later" onPress={close}>
            {t('res.main.push.later')}
          </Button>
        </>
      }
    >
      <Text variant="body" tone="muted">
        {t('res.main.push.body')}
      </Text>
    </BottomSheet>
  )
}
