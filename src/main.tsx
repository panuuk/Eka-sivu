import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './pwa'
import { useStore } from './store/store'
import { watchOtherTabs } from './store/tabs'
import { CrashScreen, ErrorBoundary } from './ui/ErrorBoundary'

// Käsittelemätön asynkroninen virhe näytetään ilmoituksena eikä jää huomaamatta.
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason)
  useStore.getState().setError(`Odottamaton virhe: ${msg}`)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={(error) => <CrashScreen error={error} />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

registerServiceWorker()
watchOtherTabs()
