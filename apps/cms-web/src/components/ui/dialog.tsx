import { AlertDialog, Dialog as RadixDialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { Button, IconButton } from './button'

const OVERLAY = 'fixed inset-0 z-40 bg-scrim'

/**
 * A dialog (DOC-54 §7.2 `Dialog`): focus is trapped, Esc and a click outside close it. `side` is the right-hand panel of the
 * staff form (480 px); `center` is the confirmation size. `dismissible: false` keeps it open while a call is in flight.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  variant = 'center',
  width,
  dismissible = true,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  variant?: 'center' | 'side'
  width?: string
  dismissible?: boolean
}) {
  const t = useT()
  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => (dismissible || next) && onOpenChange(next)}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={OVERLAY} />
        <RadixDialog.Content
          aria-describedby={description ? undefined : undefined}
          onInteractOutside={(event) => !dismissible && event.preventDefault()}
          onEscapeKeyDown={(event) => !dismissible && event.preventDefault()}
          className={cn(
            'fixed z-50 flex max-h-[90vh] flex-col bg-surface shadow-float outline-none',
            variant === 'side'
              ? 'inset-y-0 right-0 w-full max-w-[480px] rounded-l-card'
              : 'left-1/2 top-1/2 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-card',
            variant === 'center' && (width ?? 'max-w-[480px]'),
          )}
        >
          <div className="flex items-start justify-between gap-4 p-6 pb-2">
            <div>
              <RadixDialog.Title className="text-title-2 text-ink">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-secondary text-ink-muted">
                  {description}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <IconButton icon="x" label={t('common.action.close')} size="sm" disabled={!dismissible} />
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-2">{children}</div>
          {footer && <div className="flex items-center justify-end gap-3 p-6 pt-4">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

/**
 * A confirmation that names the consequence in one sentence and a confirm button named after the action, never "OK" (UX-14).
 * It is an `alertdialog`: the user must answer.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  loading,
  tone = 'primary',
  children,
  confirmDisabled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  body?: ReactNode
  confirmLabel: string
  onConfirm: () => void
  loading?: boolean
  tone?: 'primary' | 'danger'
  children?: ReactNode
  confirmDisabled?: boolean
}) {
  const t = useT()
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => (!loading || next) && onOpenChange(next)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={OVERLAY} />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card bg-surface p-6 shadow-float outline-none">
          <AlertDialog.Title className="text-title-2 text-ink">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-body text-ink-muted">
            {body}
          </AlertDialog.Description>
          {children && <div className="mt-4">{children}</div>}
          <div className="mt-6 flex justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost" disabled={loading}>
                {t('common.action.cancel')}
              </Button>
            </AlertDialog.Cancel>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={loading}
              disabled={confirmDisabled}
              onClick={(event) => {
                // The dialog stays open until the call answers; the caller closes it.
                event.preventDefault()
                onConfirm()
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
