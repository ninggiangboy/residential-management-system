import { type ReactElement, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { ConfirmDialog } from '../../components/ui/dialog'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { type FeeBatchView, useFeeBatchMutations } from './hooks'

/** "Xóa bản nháp": the confirm of E-172; its code is never issued again (DOC-66 §6, UIWF-20). */
export function DiscardDialog({
  open,
  batch,
  onClose,
  onDiscarded,
  onConflict,
}: {
  open: boolean
  batch: FeeBatchView
  onClose: () => void
  onDiscarded: () => void
  onConflict: () => void
}): ReactElement {
  const { t } = useI18n()
  const { discard } = useFeeBatchMutations(batch.id)
  const [banner, setBanner] = useState<string | null>(null)

  const confirm = () => {
    setBanner(null)
    discard.mutate(batch.version, {
      onSuccess: () => {
        toast.success(t('web.fee-batch.discard.toast', { code: batch.code }))
        onDiscarded()
      },
      onError: (thrown) => {
        const failure = apiErrorOf(thrown)
        // The draft changed or was published: refetch and show it rather than retry blindly.
        if (failure.code === 'version_conflict' || failure.code === 'invalid_transition')
          onConflict()
        setBanner(errorText(t, failure))
      },
    })
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => !next && !discard.isPending && onClose()}
      title={t('web.fee-batch.discard.title', { code: batch.code })}
      body={t('web.fee-batch.discard.body', { code: batch.code })}
      confirmLabel={t('web.fee-batch.action.discard')}
      tone="danger"
      loading={discard.isPending}
      onConfirm={confirm}
    >
      {banner && <Banner tone="danger">{banner}</Banner>}
    </ConfirmDialog>
  )
}
