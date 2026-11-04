import { Text, View } from '@react-pdf/renderer'
import { pdfStyles } from '../styles'

/**
 * The money table of DOC-34 §5 (`Item · Basis · Amount`): a header row, a 1 pt rule below it,
 * one `wrap={false}` row per line so a row never splits, and an optional total block the last row
 * is kept with through `minPresenceAhead` (DR-56, DR-292).
 */

/** Estimate of the total block height in points (DOC-34 §5, the row and total keep-together). */
export const DEFAULT_TOTAL_HEIGHT = 48

export type MoneyColumn = {
  key: string
  header: string
  headerSecondary?: string
  width: number | string
  align: 'left' | 'right'
}

export type MoneyCell = {
  text: string
  secondary?: string
}

export type MoneyRow = {
  key: string
  cells: readonly MoneyCell[]
}

export type MoneyTotal = {
  label: string
  labelSecondary?: string
  amount: string
}

function HeaderRow(props: { columns: readonly MoneyColumn[] }) {
  return (
    <>
      <View style={pdfStyles.row}>
        {props.columns.map((column) => (
          <View key={column.key} style={{ width: column.width }}>
            <Text style={[pdfStyles.label, { textAlign: column.align }]}>{column.header}</Text>
            {column.headerSecondary ? (
              <Text style={[pdfStyles.secondary, { textAlign: column.align }]}>
                {column.headerSecondary}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      <View style={pdfStyles.tableHeaderRule} />
    </>
  )
}

function BodyRow(props: {
  columns: readonly MoneyColumn[]
  row: MoneyRow
  minPresenceAhead?: number
}) {
  return (
    <View style={pdfStyles.row} wrap={false} minPresenceAhead={props.minPresenceAhead}>
      {props.columns.map((column, at) => {
        const cell = props.row.cells[at]
        return (
          <View key={column.key} style={{ width: column.width }}>
            <Text style={{ textAlign: column.align }}>{cell?.text ?? ''}</Text>
            {cell?.secondary ? (
              <Text style={[pdfStyles.secondary, { textAlign: column.align }]}>
                {cell.secondary}
              </Text>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

function TotalRow(props: { columns: readonly MoneyColumn[]; total: MoneyTotal }) {
  const amountColumn = props.columns[props.columns.length - 1]
  return (
    <>
      <View style={pdfStyles.rule} />
      <View style={pdfStyles.row} wrap={false}>
        <View style={{ flexGrow: 1 }}>
          <Text style={{ textAlign: 'right' }}>{props.total.label}</Text>
          {props.total.labelSecondary ? (
            <Text style={[pdfStyles.secondary, { textAlign: 'right' }]}>
              {props.total.labelSecondary}
            </Text>
          ) : null}
        </View>
        <View style={{ width: amountColumn?.width ?? 'auto' }}>
          <Text style={pdfStyles.total}>{props.total.amount}</Text>
        </View>
      </View>
    </>
  )
}

export function MoneyTable(props: {
  columns: readonly MoneyColumn[]
  rows: readonly MoneyRow[]
  total?: MoneyTotal
  totalHeight?: number
}) {
  const last = props.rows.length - 1
  return (
    <View>
      <HeaderRow columns={props.columns} />
      {props.rows.map((row, at) => (
        <BodyRow
          key={row.key}
          columns={props.columns}
          row={row}
          minPresenceAhead={at === last ? (props.totalHeight ?? DEFAULT_TOTAL_HEIGHT) : undefined}
        />
      ))}
      {props.total ? <TotalRow columns={props.columns} total={props.total} /> : null}
    </View>
  )
}
