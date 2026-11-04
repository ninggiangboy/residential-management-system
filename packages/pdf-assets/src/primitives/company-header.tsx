import { Buffer } from 'node:buffer'
import { Image, Text, View } from '@react-pdf/renderer'
import { pdfStyles } from '../styles'

/**
 * The header of DOC-34 §6.1/§6.2 and §7.1/§7.2 (DR-56, DR-292): the optional 56 pt logo, the
 * company name and address, the contact and tax lines, and the building name on the right. Every
 * string is localised by the caller, so no label word is printed here.
 */
export function CompanyHeader(props: {
  name: string
  address?: string
  contactLine?: string
  taxLine?: string
  buildingName?: string
  logo?: Uint8Array
}) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {props.logo ? (
        <Image src={Buffer.from(props.logo)} style={{ width: 56, height: 56 }} />
      ) : null}
      <View style={{ flexGrow: 1 }}>
        <Text style={{ ...pdfStyles.subtitle, fontWeight: 600 }}>{props.name}</Text>
        {props.address ? <Text>{props.address}</Text> : null}
        {props.contactLine ? <Text>{props.contactLine}</Text> : null}
        {props.taxLine ? <Text>{props.taxLine}</Text> : null}
      </View>
      {props.buildingName ? <Text style={{ textAlign: 'right' }}>{props.buildingName}</Text> : null}
    </View>
  )
}
