import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api } from '../api'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const [status, setStatus] = useState('…')
  useEffect(() => {
    api.api.v1.health.live.get().then(({ data }) => setStatus(data?.status ?? 'down'))
  }, [])
  return <p className="p-4 text-lg font-medium">API: {status}</p>
}
