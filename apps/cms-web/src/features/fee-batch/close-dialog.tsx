import { type ReactElement, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { ConfirmDialog } from '../../components/ui/dialog'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { type FeeBatchView, useFeeBatchMutations } from './hooks'

/** "Đóng đợt": the confirm of E-97; unpaid charges stay payable (DOC-66 §6, UIWF-22). */
export function CloseDialog({
  open,
  batch,
  onClose,
  onClosed,
  onConflict,
}: {
  open: boolean
  batch: FeeBatchView
  onClose: () => void
  onClosed: () => void
  onConflict: () => void
}): ReactElement {
  const { t } = useI18n()
  const { close } = useFeeBatchMutations(batch.id)
  const [banner, setBanner] = useState<string | null>(null)

  const confirm = () => {
    setBanner(null)
    close.mutate(batch.version, {
      onSuccess: () => {
        toast.success(t('web.fee-batch.close.toast', { code: batch.code }))
        onClosed()
      },
      onError: (thrown) => {
        const failure = apiErrorOf(thrown)
        if (failure.code === 'invalid_transition' || failure.code === 'version_conflict')
          onConflict()
        setBanner(errorText(t, failure))
      },
    })
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => !next && !close.isPending && onClose()}
      title={t('web.fee-batch.close.title', { code: batch.code })}
      body={t('web.fee-batch.close.body')}
      confirmLabel={t('web.fee-batch.action.close')}
      loading={close.isPending}
      onConfirm={confirm}
    >
      {banner && <Banner tone="danger">{banner}</Banner>}
    </ConfirmDialog>
  )
}
