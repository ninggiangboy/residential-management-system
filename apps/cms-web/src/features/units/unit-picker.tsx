import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { labelStyles } from '../../components/ui/field'
import { Skeleton } from '../../components/ui/skeleton'
import { Plate } from '../../components/ui/tag'
import { SearchField } from '../../components/ui/text-field'
import { useI18n } from '../../lib/i18n'
import { useDebounced } from '../../lib/use-debounced'
import { useDelayedFlag } from '../../lib/use-delayed-flag'
import { cn } from '../../lib/utils'
import { type UnitListItem, unitsQuery } from './hooks'

export interface PickedUnit {
  unitId: string
  code: string
}

/**
 * A typeahead over E-57 (`q`, at least 2 characters, at most 20 results): `W-Resident-Add` picks the unit with it and `W-Residents`
 * filters by it (DOC-65). A chosen unit shows as a plate with a button to clear it
 * (a skeleton while its code is still unknown, as for `?unitId=`).
 */
export function UnitPicker({
  label,
  value,
  onChange,
  error,
  hint,
  disabled,
  required,
  onUnits,
}: {
  label: string
  required?: boolean
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
  // From the first keystroke (the debounce pause included) until the answer is in; the row waits 150 ms so a fast answer shows
  // nothing (DR-306).
  const typedEnough = value === null && typed.trim().length >= 2
  const pending = typedEnough && (typed.trim() !== q || results.isFetching)
  const searching = useDelayedFlag(pending)
  const items = enabled && results.data ? results.data.items : []

  if (value)
    return (
      <div className="flex flex-col gap-2">
        <span className={labelStyles}>
          {label}
          {required && (
            <span aria-hidden="true" className="ml-0.5 text-danger">
              *
            </span>
          )}
        </span>
        <div className="flex h-control-md items-center justify-between rounded-control border border-line-input bg-surface pl-3 pr-0.5 shadow-field">
          {value.code ? <Plate>{value.code}</Plate> : <Skeleton className="h-6 w-16" />}
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
      <SearchField
        label={label}
        required={required}
        placeholder={t('web.units.field.search.placeholder')}
        value={typed}
        disabled={disabled}
        autoComplete="off"
        error={error}
        hint={typed.trim().length === 1 ? t('web.units.field.search.hint') : undefined}
        onChange={(event) => setTyped(event.target.value)}
      />
      {typedEnough && (searching || (!pending && results.data)) && (
        <ul
          aria-busy={searching || undefined}
          className="motion-pop absolute z-30 mt-1 origin-top max-h-64 w-full overflow-y-auto rounded-control border border-line bg-surface p-1 shadow-float"
        >
          {searching && (
            <li
              role="status"
              className="flex min-h-control-md items-center gap-3 px-2.5 text-secondary text-ink-muted"
            >
              <span
                aria-hidden="true"
                className="size-icon-sm animate-spin rounded-full border-2 border-ink-disabled border-t-transparent"
              />
              {t('web.units.field.search.loading')}
            </li>
          )}
          {!pending && items.length === 0 && (
            <li className="flex min-h-control-md items-center px-2.5 text-secondary text-ink-muted">
              {t('web.units.field.search.empty')}
            </li>
          )}
          {items.map((unit) => (
            <li key={unit.unitId} className={cn(pending && 'opacity-60')}>
              <button
                type="button"
                disabled={pending}
                className="flex min-h-control-md w-full items-center gap-3 rounded-plate px-2.5 text-left hover:bg-fill focus-visible:outline-2 focus-visible:outline-focus"
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
