import { Text, View } from '@react-pdf/renderer'
import { pdfStyles } from '../styles'

/**
 * One label/value pair of DOC-34 §5 `both` mode (DR-71, DR-292): the 8.5 pt label, its English
 * secondary line directly under it when given, then the value and its secondary line. The caller
 * passes the localised strings; the secondary line is the italic `inkMuted` line of §5.
 */
export function LabelPair(props: {
  label: string
  labelSecondary?: string
  value: string
  valueSecondary?: string
  width?: number | string
}) {
  return (
    <View style={props.width === undefined ? undefined : { width: props.width }}>
      <Text style={pdfStyles.label}>{props.label}</Text>
      {props.labelSecondary ? (
        <Text style={pdfStyles.secondary}>{props.labelSecondary}</Text>
      ) : null}
      <Text>{props.value}</Text>
      {props.valueSecondary ? (
        <Text style={pdfStyles.secondary}>{props.valueSecondary}</Text>
      ) : null}
    </View>
  )
}
