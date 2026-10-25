import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { Plate } from '../../components/ui/tag'
import { TextField } from '../../components/ui/text-field'
import { useI18n } from '../../lib/i18n'
import { useDebounced } from '../../lib/use-debounced'
import { type UnitListItem, unitsQuery } from './hooks'

export interface PickedUnit {
  unitId: string
  code: string
}

/**
 * A typeahead over E-57 (`q`, at least 2 characters, at most 20 results): `W-Resident-Add` picks the unit with it and `W-Residents`
 * filters by it (DOC-65). A chosen unit shows as a plate with a button to clear it.
 */
export function UnitPicker({
  label,
  value,
  onChange,
  error,
  hint,
  disabled,
  onUnits,
}: {
  label: string
  value: PickedUnit | null
  onChange: (unit: PickedUnit | null) => void
  error?: string
  hint?: (unit: UnitListItem) => string
  disabled?: boolean
  /** The picker reports the last result list so the caller can read an owner or an occupancy (UIWR-26). */
  onUnits?: (units: UnitListItem[]) => void
}) {
  const { t } = useI18n()
  const [typed, setTyped] = useState('')
  const q = useDebounced(typed.trim())
  const enabled = value === null && q.length >= 2
  const results = useQuery({ ...unitsQuery({ q, limit: 20 }), enabled })

  if (value)
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-ink">{label}</span>
        <div className="flex h-control-lg items-center justify-between rounded-control border border-line-strong bg-surface px-4">
          <Plate>{value.code}</Plate>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
            {t('common.action.clear-filters')}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-secondary text-danger">
            {error}
          </p>
        )}
      </div>
    )

  return (
    <div className="relative">
      <TextField
        label={label}
        placeholder={t('web.units.field.search.placeholder')}
        value={typed}
        disabled={disabled}
        autoComplete="off"
        error={error}
        hint={typed.trim().length === 1 ? t('web.units.field.search.hint') : undefined}
        onChange={(event) => setTyped(event.target.value)}
      />
      {enabled && results.data && results.data.items.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-control border border-line bg-surface p-1 shadow-float">
          {results.data.items.map((unit) => (
            <li key={unit.unitId}>
              <button
                type="button"
                className="flex min-h-control-md w-full items-center gap-3 rounded-control px-3 text-left hover:bg-fill focus-visible:outline-2 focus-visible:outline-focus"
                onClick={() => {
                  onUnits?.(results.data?.items ?? [])
                  onChange({ unitId: unit.unitId, code: unit.code })
                  setTyped('')
                }}
              >
                <Plate>{unit.code}</Plate>
                <span className="text-secondary text-ink-muted">{hint?.(unit)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
