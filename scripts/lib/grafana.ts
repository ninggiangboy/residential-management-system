/**
 * A small builder for the Grafana dashboards of DOC-40 §7: panels are declared with their queries and flow into a 24-column grid,
 * so a dashboard file is a list and not a page of JSON. `scripts/build-dashboards.ts` writes the result to `ops/grafana/dashboards/`.
 */

export const PROMETHEUS = { type: 'prometheus', uid: 'prometheus' } as const
export const LOKI = { type: 'loki', uid: 'loki' } as const

export interface Query {
  expr: string
  legend?: string
  /** One value per series instead of a range (tables, stats). */
  instant?: boolean
  refId?: string
}

interface PanelOptions {
  description?: string
  unit?: string
  /** Width in grid columns (of 24) and height in rows. */
  w?: number
  h?: number
  /** Threshold steps `[value, color]`; the first is the base. */
  thresholds?: Array<[number | null, string]>
  /** Draw the thresholds as lines on a time series (the NFR-03 lines at 0.3 and 0.8 s). */
  thresholdLines?: boolean
  min?: number
  max?: number
  transformations?: object[]
  /** Which alert or requirement this panel supports (DOC-40 §7: a panel nobody reads is not added). */
  supports?: string
}

export interface Panel {
  type: string
  title: string
  datasource: typeof PROMETHEUS | typeof LOKI
  targets: object[]
  w: number
  h: number
  extra: object
}

const targets = (queries: Query[], datasource: Panel['datasource']) =>
  queries.map((query, index) => ({
    datasource,
    refId: query.refId ?? String.fromCharCode(65 + index),
    expr: query.expr,
    legendFormat: query.legend ?? '',
    ...(query.instant ? { instant: true, range: false, format: 'table' } : {}),
  }))

const thresholdConfig = (options: PanelOptions) => ({
  thresholds: {
    mode: 'absolute',
    steps: (options.thresholds ?? [[null, 'green']]).map(([value, color]) => ({ value, color })),
  },
})

const describe = (options: PanelOptions) =>
  [options.description, options.supports ? `Supports: ${options.supports}.` : undefined]
    .filter(Boolean)
    .join(' ')

export function timeseries(title: string, queries: Query[], options: PanelOptions = {}): Panel {
  return {
    type: 'timeseries',
    title,
    datasource: PROMETHEUS,
    targets: targets(queries, PROMETHEUS),
    w: options.w ?? 12,
    h: options.h ?? 8,
    extra: {
      description: describe(options),
      fieldConfig: {
        defaults: {
          unit: options.unit ?? 'short',
          min: options.min,
          max: options.max,
          ...thresholdConfig(options),
          custom: {
            lineWidth: 2,
            fillOpacity: 8,
            showPoints: 'never',
            thresholdsStyle: { mode: options.thresholdLines ? 'line' : 'off' },
          },
        },
        overrides: [],
      },
      options: { legend: { displayMode: 'list', placement: 'bottom' }, tooltip: { mode: 'multi' } },
    },
  }
}

export function stat(title: string, queries: Query[], options: PanelOptions = {}): Panel {
  return {
    type: 'stat',
    title,
    datasource: PROMETHEUS,
    targets: targets(queries, PROMETHEUS),
    w: options.w ?? 6,
    h: options.h ?? 4,
    extra: {
      description: describe(options),
      fieldConfig: {
        defaults: { unit: options.unit ?? 'short', ...thresholdConfig(options) },
        overrides: [],
      },
      options: {
        colorMode: 'background',
        graphMode: 'none',
        reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false },
      },
    },
  }
}

export function table(title: string, queries: Query[], options: PanelOptions = {}): Panel {
  return {
    type: 'table',
    title,
    datasource: PROMETHEUS,
    targets: targets(
      queries.map((query) => ({ ...query, instant: true })),
      PROMETHEUS,
    ),
    w: options.w ?? 12,
    h: options.h ?? 8,
    extra: {
      description: describe(options),
      fieldConfig: { defaults: { unit: options.unit ?? 'short' }, overrides: [] },
      options: { showHeader: true },
      transformations: options.transformations ?? [],
    },
  }
}

export function logs(title: string, expr: string, options: PanelOptions = {}): Panel {
  return {
    type: 'logs',
    title,
    datasource: LOKI,
    targets: [{ datasource: LOKI, refId: 'A', expr, queryType: 'range' }],
    w: options.w ?? 24,
    h: options.h ?? 9,
    extra: {
      description: describe(options),
      options: {
        showTime: true,
        wrapLogMessage: true,
        prettifyLogMessage: true,
        enableLogDetails: true,
        sortOrder: 'Descending',
      },
    },
  }
}

export interface Variable {
  name: string
  label: string
  /** A free-text box (the `requestId` of the Logs dashboard). */
  textbox: string
}

export interface Dashboard {
  uid: string
  title: string
  description: string
  panels: Panel[]
  variables?: Variable[]
}

/** The JSON that Grafana provisions: stable ids and positions, so a change to a panel is a small diff. */
export function render(dashboard: Dashboard): string {
  let x = 0
  let y = 0
  let rowHeight = 0
  const panels = dashboard.panels.map((panel, index) => {
    if (x + panel.w > 24) {
      x = 0
      y += rowHeight
      rowHeight = 0
    }
    const placed = {
      id: index + 1,
      type: panel.type,
      title: panel.title,
      datasource: panel.datasource,
      gridPos: { x, y, w: panel.w, h: panel.h },
      targets: panel.targets,
      ...panel.extra,
    }
    x += panel.w
    rowHeight = Math.max(rowHeight, panel.h)
    return placed
  })
  return `${JSON.stringify(
    {
      uid: dashboard.uid,
      title: dashboard.title,
      description: dashboard.description,
      tags: ['rms'],
      editable: false,
      graphTooltip: 1,
      schemaVersion: 41,
      refresh: '30s',
      time: { from: 'now-6h', to: 'now' },
      timezone: 'browser',
      templating: {
        list: (dashboard.variables ?? []).map((variable) => ({
          name: variable.name,
          label: variable.label,
          type: 'textbox',
          query: variable.textbox,
          current: { text: variable.textbox, value: variable.textbox },
          options: [{ selected: true, text: variable.textbox, value: variable.textbox }],
        })),
      },
      annotations: { list: [] },
      panels,
    },
    null,
    2,
  )}\n`
}
