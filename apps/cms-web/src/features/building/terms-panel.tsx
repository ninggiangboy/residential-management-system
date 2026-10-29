import { isTermsError, parseTermsMarkdown } from '@rms/shared-types'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { apiErrorOf } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { ConfirmDialog, Dialog, useExit } from '../../components/ui/dialog'
import { TextAreaField } from '../../components/ui/text-field'
import { toast } from '../../components/ui/toaster'
import { errorText, useI18n } from '../../lib/i18n'
import { type TermsKind, termsQuery, usePublishTerms } from './hooks'

/** The first violation of a text as `{line, rule}`, or `null` when it is valid (the same function as the API's, DOC-36 §8). */
function violation(text: string) {
  if (text.trim() === '') return null
  const parsed = parseTermsMarkdown(text)
  return isTermsError(parsed) ? parsed : null
}

/** `?dialog=terms&kind=…` of `W-Building`: the current text, two text areas and the line the check stops at (UIWS-22). */
export function TermsPanel({ kind, onClose }: { kind: TermsKind; onClose: () => void }) {
  const { t, lang } = useI18n()
  const versions = useQuery(termsQuery(kind))
  const publish = usePublishTerms()
  const latest = versions.data?.[0]
  const [vi, setVi] = useState('')
  const [en, setEn] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [seeded, setSeeded] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  // The search param unmounts the panel; `useExit` lets it leave with its motion first (DR-304).
  const { open, close } = useExit(onClose)

  // The panel starts from the current text, so a small fix is an edit and not a rewrite.
  useEffect(() => {
    if (latest && !seeded) {
      setVi(latest.text.vi)
      setEn(latest.text.en ?? '')
      setSeeded(true)
    }
  }, [latest, seeded])

  const viProblem = useMemo(() => violation(vi), [vi])
  const enProblem = useMemo(() => violation(en), [en])
  const missing = vi.trim() === ''
  const blocked = missing || viProblem !== null || enProblem !== null

  const submit = () =>
    publish.mutate(
      { kind, vi, en },
      {
        onSuccess: (created) => {
          toast.success(t('web.building.toast.terms-published', { version: created.version }))
          setConfirming(false)
          close()
        },
        onError: (thrown) => {
          setConfirming(false)
          const failure = apiErrorOf(thrown)
          if (failure.code === 'version_conflict') void versions.refetch()
          setBanner(errorText(t, failure))
        },
      },
    )

  const problemText = (problem: { line: number; rule: string } | null) =>
    problem ? t('error.validation_failed') + ` (${problem.line}: ${problem.rule})` : undefined

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => !next && close()}
        title={t(
          kind === 'terms' ? 'web.building.card.terms.title' : 'web.building.card.privacy.title',
        )}
        description={
          latest
            ? t('web.building.terms.version', {
                version: latest.version,
                date: new Date(latest.publishedAt).toLocaleDateString(lang),
              })
            : undefined
        }
        width="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              {t('common.action.cancel')}
            </Button>
            <Button
              disabled={blocked}
              loading={publish.isPending}
              onClick={() => setConfirming(true)}
            >
              {t('web.building.dialog.publish.confirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 py-2">
          {banner && <Banner tone="danger">{banner}</Banner>}
          <div className="grid gap-4 md:grid-cols-2">
            <TextAreaField
              label="Tiếng Việt"
              rows={14}
              maxRows={14}
              value={vi}
              onChange={(event) => setVi(event.target.value)}
              error={problemText(viProblem)}
            />
            <TextAreaField
              label="English"
              rows={14}
              maxRows={14}
              value={en}
              onChange={(event) => setEn(event.target.value)}
              error={problemText(enProblem)}
            />
          </div>
        </div>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('web.building.terms.publish')}
        body={t('web.building.dialog.publish.body')}
        confirmLabel={t('web.building.dialog.publish.confirm')}
        loading={publish.isPending}
        onConfirm={submit}
      />
    </>
  )
}
