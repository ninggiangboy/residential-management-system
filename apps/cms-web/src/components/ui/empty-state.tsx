import type { IconName } from '@rms/design-tokens'
import type { ReactNode } from 'react'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { Button } from './button'
import { Icon } from './icon'

/** An icon well, a title, a body and one action (DOC-68 §2). */
export function EmptyState({
  icon = 'info',
  title,
  body,
  actions,
  reference,
  className,
}: {
  icon?: IconName
  title: ReactNode
  body?: ReactNode
  actions?: ReactNode
  /** The request id of a failed call: "Mã tham chiếu: …". */
  reference?: string
  className?: string
}) {
  const t = useT()
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-10 text-center', className)}>
      <span className="flex size-14 items-center justify-center rounded-control bg-teal-soft text-on-teal-soft">
        <Icon name={icon} size="lg" />
      </span>
      <h2 className="text-title-3 text-ink">{title}</h2>
      {body && <p className="max-w-md text-secondary text-ink-muted">{body}</p>}
      {actions && <div className="mt-2 flex flex-wrap justify-center gap-3">{actions}</div>}
      {reference && (
        <p className="text-caption text-ink-muted">{t('common.reference', { requestId: reference })}</p>
      )}
    </div>
  )
}

/** The page error state of DOC-68 §2: the main query failed. The shell around it stays usable. */
export function ErrorState({ requestId, onRetry }: { requestId?: string; onRetry: () => void }) {
  const t = useT()
  return (
    <EmptyState
      icon="warning"
      title={t('common.error.page.title')}
      body={t('common.error.page.body')}
      reference={requestId || undefined}
      actions={
        <Button variant="outline" onClick={onRetry}>
          {t('common.action.retry')}
        </Button>
      }
    />
  )
}

export function ForbiddenState() {
  const t = useT()
  return <EmptyState icon="lock" title={t('common.forbidden.title')} body={t('common.forbidden.body')} />
}
