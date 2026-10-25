import { lazy, type ReactNode, Suspense } from 'react'

const Impl = lazy(() => import('./sonner-toaster'))

/** The toast library loads after the first paint: no page needs it before a user acts (the budget of DOC-53 §8, DR-264). */
export function Toaster() {
  return (
    <Suspense fallback={null}>
      <Impl />
    </Suspense>
  )
}

interface Options {
  description?: ReactNode
}

const load = () => import('sonner').then((module) => module.toast)

export const toast = {
  success(message: ReactNode, options?: Options): void {
    void load().then((t) => t.success(message, options))
  },
  error(message: ReactNode, options?: Options): void {
    void load().then((t) => t.error(message, options))
  },
}
