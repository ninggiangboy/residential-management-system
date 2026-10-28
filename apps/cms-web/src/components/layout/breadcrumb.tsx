import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'

/** One crumb of a route's `staticData`: a catalog key and the page it opens. Only pages without required search params. */
export interface Crumb {
  label: string
  to: '/' | '/units' | '/residents' | '/staff' | '/building' | '/import' | '/profile'
}

interface Tail {
  tail: string | null
  setTail(text: string | null): void
}
const Context = createContext<Tail>({ tail: null, setTail: () => {} })

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [tail, setTail] = useState<string | null>(null)
  return <Context.Provider value={{ tail, setTail }}>{children}</Context.Provider>
}

export const useBreadcrumbTail = () => useContext(Context).tail

/** A detail page names its last crumb (the unit code in "Cư dân / Căn hộ / A-1508"); the crumb is cleared when the page goes. */
export function useSetBreadcrumbTail(text: string | null) {
  const { setTail } = useContext(Context)
  useEffect(() => {
    setTail(text)
    return () => setTail(null)
  }, [text, setTail])
}
