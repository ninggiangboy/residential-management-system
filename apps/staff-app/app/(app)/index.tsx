import { Redirect } from 'expo-router'

/** Until a role's first screen ships (P4 for the Manager and the Technician, P5 for the Guard), the signed-in app lands on `S-Account` (DOC-61, DR-174). */
export default function Landing() {
  return <Redirect href="/account" />
}
