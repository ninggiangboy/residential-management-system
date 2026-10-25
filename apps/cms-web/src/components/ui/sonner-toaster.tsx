import { Toaster as Sonner } from 'sonner'

/** Toasts are 5 s and dismissible (DOC-68 §2); the colors come from the tokens through the classes below. */
export default function SonnerToaster() {
  return (
    <Sonner
      position="bottom-right"
      duration={5000}
      closeButton
      toastOptions={{
        classNames: {
          toast:
            '!rounded-control !border-line !bg-surface !text-ink !shadow-float !font-sans !text-secondary',
          closeButton: '!border-line !bg-surface !text-ink',
        },
      }}
    />
  )
}
