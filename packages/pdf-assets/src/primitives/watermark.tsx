import { Text, View } from '@react-pdf/renderer'
import { pdfStyles } from '../styles'

/**
 * The diagonal watermark of DOC-34 §7.1 (DR-56): 120 pt Bold in `danger` at 18% opacity, fixed so
 * it prints on every page (the void copy of a receipt). Both are props so a template may tune them.
 */
export function Watermark(props: { text: string; fontSize?: number; opacity?: number }) {
  const fontSize = props.fontSize ?? 120
  const opacity = props.opacity ?? 0.18
  return (
    <View fixed style={pdfStyles.watermarkLayer}>
      <Text style={[pdfStyles.watermarkText, { fontSize, opacity, transform: 'rotate(-35deg)' }]}>
        {props.text}
      </Text>
    </View>
  )
}
