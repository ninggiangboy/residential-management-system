import { useRouter } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { useT } from '../lib/i18n'
import {
  isChunkLoadError,
  reloadOnceForNewDeploy,
  reportError,
  routeTemplate,
} from '../lib/report-error'
import { Button } from './ui/button'
import { EmptyState } from './ui/empty-state'

/**
 * The boundary of a route (DOC-55 §15): a render error is reported once as `render`, with the reference the person can read out; a
 * chunk that is gone after a deploy reloads the page once instead. "Something went wrong" and a Reload button; the shell around it
 * stays up because the boundary is the route's, not the page's.
 */
export function RouteError({ error }: { error: unknown }) {
  const t = useT()
  const router = useRouter()
  const reference = useRef(crypto.randomUUID())
  useEffect(() => {
    if (isChunkLoadError(error) && reloadOnceForNewDeploy()) return
    reportError('render', error, { screen: routeTemplate(router), requestId: reference.current })
  }, [error, router])
  return (
    <main className="mx-auto max-w-xl p-8">
      <EmptyState
        icon="warning"
        title={t('common.error.boundary.title')}
        body={t('common.error.boundary.body')}
        reference={reference.current}
        actions={
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t('common.action.reload')}
          </Button>
        }
      />
    </main>
  )
}
