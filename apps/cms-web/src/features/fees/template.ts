import { toast } from '../../components/ui/toaster'
import { fetchFile, saveBlob } from '../../lib/download'
import type { T } from '../../lib/i18n'

const FALLBACK_NAME = 'fee-batch-template.xlsx'

/**
 * E-71 with `kind` `fee_batch` (DOC-66 `W-Fees` §5): the import template, in the language the staff member uses. The bytes
 * carry the bearer token, so the file is fetched and saved, never opened as a link; a 403 or a 404 (DOC-66 §6) shows the
 * generic error toast.
 */
export async function downloadFeeBatchTemplate(t: T): Promise<void> {
  try {
    const { blob, name } = await fetchFile('/staff/imports/templates/fee_batch', FALLBACK_NAME)
    saveBlob(blob, name)
  } catch {
    toast.error(t('common.error.page.body'))
  }
}
