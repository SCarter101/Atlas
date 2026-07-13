import { normalizeError } from '@shared/errors'
import { useAtlasStore } from '../state/store'

// Catch-all for renderer-side failures that never reach a React error
// boundary: unhandled promise rejections (e.g. a rejected window.atlas.* call
// nobody awaited) and uncaught runtime errors in event handlers/timers. Both
// route to a persistent error toast so the writer sees *something* instead of
// a silent no-op. Registered once from main.tsx.

// Guard so a throw inside the handler itself can't spiral into an infinite
// error→handler→error loop.
let handling = false

function report(err: unknown): void {
  if (handling) return
  handling = true
  try {
    const { message } = normalizeError(err)
    console.error('[global-error]', err)
    useAtlasStore.getState().pushToast('error', message)
  } catch (inner) {
    // Last resort — never let the error surface crash the app.
    console.error('[global-error] handler itself failed', inner)
  } finally {
    handling = false
  }
}

export function initErrorHandling(): void {
  window.addEventListener('unhandledrejection', (event) => {
    report(event.reason)
  })
  window.addEventListener('error', (event) => {
    report(event.error ?? event.message)
  })
}
