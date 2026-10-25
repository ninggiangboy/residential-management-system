import type { Language } from '@rms/shared-types'
import { useI18n } from '../../lib/i18n'
import { SegmentedControl } from '../ui/segmented-control'

/** VI / EN. Signed out it is local only; the shell passes `onChange` to save the account's language (DOC-64 shell). */
export function LanguageSwitch({
  onChange,
  disabled,
}: {
  onChange?: (lang: Language) => void
  disabled?: boolean
}) {
  const { lang, t, setLang } = useI18n()
  return (
    <SegmentedControl<Language>
      size="sm"
      label={t('web.shell.language.label')}
      value={lang}
      disabled={disabled}
      onValueChange={(next) => (onChange ? onChange(next) : setLang(next))}
      options={[
        { value: 'vi', label: t('web.shell.language.vi') },
        { value: 'en', label: t('web.shell.language.en') },
      ]}
    />
  )
}
