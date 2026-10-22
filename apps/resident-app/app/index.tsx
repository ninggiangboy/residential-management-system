import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { api } from '../src/api'

export default function Home() {
  const [status, setStatus] = useState('…')
  useEffect(() => {
    api.api.v1.health.live.get().then(({ data }) => setStatus(data?.status ?? 'down'))
  }, [])
  return (
    <View className="flex-1 items-center justify-center bg-ground">
      <Text className="font-sans-semibold text-body-strong text-ink">API: {status}</Text>
    </View>
  )
}
