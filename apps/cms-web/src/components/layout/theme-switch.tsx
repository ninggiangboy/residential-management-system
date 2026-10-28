import { useI18n } from '../../lib/i18n'
import { type ThemePreference, useTheme } from '../../lib/theme'
import { Icon } from '../ui/icon'
import { SegmentedControl } from '../ui/segmented-control'

/** System / light / dark, kept on this browser only (DR-304). Each segment is an icon; the button carries the name. */
export function ThemeSwitch() {
  const { t } = useI18n()
  const { theme, setTheme } = useTheme()
  return (
    <SegmentedControl<ThemePreference>
      size="sm"
      label={t('web.shell.theme.label')}
      value={theme}
      onValueChange={setTheme}
      className="[&_button]:px-2.5"
      options={[
        {
          value: 'system',
          label: <Icon name="desktop" size="sm" />,
          ariaLabel: t('web.shell.theme.system'),
        },
        {
          value: 'light',
          label: <Icon name="sun" size="sm" />,
          ariaLabel: t('web.shell.theme.light'),
        },
        {
          value: 'dark',
          label: <Icon name="moon" size="sm" />,
          ariaLabel: t('web.shell.theme.dark'),
        },
      ]}
    />
  )
}
