import { AlertDialog, Dialog as RadixDialog } from 'radix-ui'
import { type ReactNode, useCallback, useRef, useState } from 'react'
import { useT } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { Button, IconButton } from './button'
import { Skeleton } from './skeleton'

const OVERLAY = 'motion-overlay fixed inset-0 z-40 bg-scrim'

/** A field a person types into, enabled and writable: what a dialog focuses when it opens (DOC-54 §17.9). */
const FIRST_FIELD =
  'input:not([type=hidden],[type=file],[type=checkbox],[type=radio],.sr-only,:disabled,[readonly]), textarea:not(:disabled,[readonly])'

/** The longest exit motion of `styles.css` (the side panel, 200 ms); none when the user asks for reduced motion (DR-304). */
const exitMs = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200

/**
 * The value of the last render in which `keep` was true. A closing dialog keeps showing its content while it leaves, so a
 * caller that clears its state on close (`setConfirm(null)`) does not make the title flash empty during the exit motion.
 */
export function useHeld<T>(value: T, keep: boolean): T {
  const held = useRef(value)
  if (keep) held.current = value
  return keep ? value : held.current
}

/** The last value that was not `undefined`: what a dialog keyed by a search param still names while it closes. */
export function useLastDefined<T>(value: T | undefined): T | undefined {
  const last = useRef(value)
  if (value !== undefined) last.current = value
  return value ?? last.current
}

/**
 * A dialog that its parent unmounts to close (a route such as `/staff/new`, a search param): `close()` plays the exit motion
 * first and calls `onClose` after it, so the panel slides out instead of vanishing. A second call while it leaves is ignored.
 */
export function useExit(onClose: () => void) {
  const [open, setOpen] = useState(true)
  const latest = useRef(onClose)
  latest.current = onClose
  const leaving = useRef(false)
  const close = useCallback(() => {
    if (leaving.current) return
    leaving.current = true
    setOpen(false)
    window.setTimeout(() => latest.current(), exitMs())
  }, [])
  return { open, close }
}

/** A label and a field in the size of `TextField`: the shape a loading form shows in its place. */
export function FieldSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)} aria-hidden="true">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-control-md" />
    </div>
  )
}

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
  const shown = useHeld({ title, description, children, footer }, open)
  const body = useRef<HTMLDivElement>(null)
  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => (dismissible || next) && onOpenChange(next)}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={OVERLAY} />
        <RadixDialog.Content
          // A form opens with the caret in its first field; a dialog without one focuses itself, not the close button,
          // so no focus ring sits on the close button of a dialog opened with the mouse.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const field = body.current?.querySelector<HTMLElement>(FIRST_FIELD)
            ;(field ?? (event.currentTarget as HTMLElement | null))?.focus()
          }}
          onInteractOutside={(event) => !dismissible && event.preventDefault()}
          onEscapeKeyDown={(event) => !dismissible && event.preventDefault()}
          className={cn(
            'fixed z-50 flex flex-col border-line bg-surface shadow-float outline-none',
            // The side panel runs the full height of the window; the centred dialog stops at 90% of it.
            variant === 'side'
              ? 'motion-sheet inset-y-0 right-0 w-full max-w-[480px] rounded-l-card border-l'
              : 'motion-dialog left-1/2 top-1/2 max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-card border',
            variant === 'center' && (width ?? 'max-w-[480px]'),
          )}
        >
          {/* The body keeps its scrollbar's room, and the header and footer the same, so their right edges line up. */}
          <div className="gutter-stable flex items-start justify-between gap-4 overflow-hidden px-5 pb-2 pt-4">
            <div>
              <RadixDialog.Title className="text-title-2 text-ink">{shown.title}</RadixDialog.Title>
              {shown.description ? (
                <RadixDialog.Description className="mt-1 text-secondary text-ink-muted">
                  {shown.description}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{shown.title}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <IconButton icon="x" label={t('common.action.close')} size="sm" disabled={!dismissible} />
            </RadixDialog.Close>
          </div>
          <div ref={body} className="gutter-stable min-h-0 flex-1 overflow-y-auto px-5 py-2">
            {shown.children}
          </div>
          {shown.footer && (
            <div className="gutter-stable flex items-center justify-end gap-2 overflow-hidden border-t border-line px-5 py-3">
              {shown.footer}
            </div>
          )}
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
  const shown = useHeld({ title, body, confirmLabel, tone, children }, open)
  // The call that closes the dialog answers in the same render: the button keeps its spinner while the dialog leaves, rather
  // than turning back to its colour first (DR-306).
  const busy = useHeld(loading, open)
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => (!busy || next) && onOpenChange(next)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={OVERLAY} />
        <AlertDialog.Content className="motion-dialog fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-surface p-5 shadow-float outline-none">
          <AlertDialog.Title className="text-title-2 text-ink">{shown.title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-body text-ink-muted">
            {shown.body}
          </AlertDialog.Description>
          {shown.children && <div className="mt-4">{shown.children}</div>}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost" disabled={busy}>
                {t('common.action.cancel')}
              </Button>
            </AlertDialog.Cancel>
            <Button
              variant={shown.tone === 'danger' ? 'danger' : 'primary'}
              loading={busy}
              disabled={confirmDisabled}
              onClick={(event) => {
                // The dialog stays open until the call answers; the caller closes it.
                event.preventDefault()
                onConfirm()
              }}
            >
              {shown.confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
