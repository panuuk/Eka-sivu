import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Canvas } from './canvas/Canvas'
import { ListView } from './panels/ListView'
import { ProcessTree } from './panels/ProcessTree'
import { RightPanel } from './panels/RightPanel'
import { useStore } from './store/store'
import './store/storage'
import { useUi } from './store/ui'
import { ConfirmHost, PromptHost } from './ui/ConfirmHost'
import { ErrorBoundary, ViewCrash } from './ui/ErrorBoundary'
import { UpdateBar } from './ui/UpdateBar'
import { BackupBar, TabsBar } from './ui/BackupBar'
import { ErrorBar } from './ui/ErrorBar'
import { TopBar } from './ui/TopBar'
import { useShortcuts } from './ui/useShortcuts'
import { useNarrow } from './ui/useMedia'
import './app.css'
import './theme.css'

const EntityManager = lazy(() =>
  import('./panels/EntityManager').then((m) => ({ default: m.EntityManager })),
)
const ExportDialog = lazy(() =>
  import('./panels/ExportDialog').then((m) => ({ default: m.ExportDialog })),
)
const PresentView = lazy(() =>
  import('./panels/PresentView').then((m) => ({ default: m.PresentView })),
)
const CompareView = lazy(() =>
  import('./panels/CompareView').then((m) => ({ default: m.CompareView })),
)
const SavedViewsDialog = lazy(() =>
  import('./panels/SavedViewsDialog').then((m) => ({ default: m.SavedViewsDialog })),
)
const SyncDialog = lazy(() =>
  import('./panels/SyncDialog').then((m) => ({ default: m.SyncDialog })),
)
const ProcessCardDialog = lazy(() =>
  import('./panels/ProcessCardDialog').then((m) => ({ default: m.ProcessCardDialog })),
)
const VersionsDialog = lazy(() =>
  import('./panels/VersionsDialog').then((m) => ({ default: m.VersionsDialog })),
)
const AnalysisView = lazy(() =>
  import('./panels/AnalysisView').then((m) => ({ default: m.AnalysisView })),
)
const ImportDialog = lazy(() =>
  import('./panels/ImportDialog').then((m) => ({ default: m.ImportDialog })),
)
const HelpDialog = lazy(() =>
  import('./panels/HelpDialog').then((m) => ({ default: m.HelpDialog })),
)
const SourcesView = lazy(() =>
  import('./panels/SourcesView').then((m) => ({ default: m.SourcesView })),
)
const QuickInput = lazy(() =>
  import('./panels/QuickInput').then((m) => ({ default: m.QuickInput })),
)
const ReplaceDialog = lazy(() =>
  import('./panels/ReplaceDialog').then((m) => ({ default: m.ReplaceDialog })),
)
const StorageDialog = lazy(() =>
  import('./panels/StorageDialog').then((m) => ({ default: m.StorageDialog })),
)

/** Raskaat näkymät ja ikkunat ladataan vasta, kun niitä tarvitaan ensimmäisen kerran. */
function OnFirstOpen({ open, children }: { open: boolean; children: ReactNode }) {
  const [seen, setSeen] = useState(open)
  if (open && !seen) setSeen(true)
  return seen ? <Suspense fallback={null}>{children}</Suspense> : null
}

function App() {
  const ready = useStore((s) => s.ready)
  const view = useUi((s) => s.view)
  const leftOpen = useUi((s) => s.leftOpen)
  const rightOpen = useUi((s) => s.rightOpen)
  const presenting = useUi((s) => s.presenting)
  const exportOpen = useUi((s) => s.exportOpen)
  const savedViewsOpen = useUi((s) => s.savedViewsOpen)
  const quickOpen = useUi((s) => s.quickOpen)
  const importOpen = useUi((s) => s.importOpen)
  const helpOpen = useUi((s) => s.helpOpen)
  const replaceOpen = useUi((s) => s.replaceOpen)
  const versionsOpen = useUi((s) => s.versionsOpen)
  const cardOpen = useUi((s) => s.cardOpen)
  const syncOpen = useUi((s) => s.syncOpen)
  const storageOpen = useUi((s) => s.storageOpen)
  const entityManagerOpen = useUi((s) => s.entityManagerOpen)
  const narrow = useNarrow()
  useShortcuts()

  useEffect(() => {
    void useStore.getState().init()
  }, [])

  // Ladataan yleisimmin tarvittavat osat valmiiksi, kun sovellus on ehtinyt rauhoittua
  useEffect(() => {
    if (!ready) return
    const id = window.setTimeout(() => {
      void import('./panels/QuickInput')
      void import('./panels/PresentView')
      void import('./panels/ExportDialog')
      void import('./panels/SourcesView')
    }, 2500)
    return () => window.clearTimeout(id)
  }, [ready])

  if (!ready) return <div className="loading">Ladataan…</div>

  if (presenting) {
    return (
      <div className="app app--present">
        <Suspense fallback={<div className="loading">Ladataan…</div>}>
          <PresentView />
        </Suspense>
        <OnFirstOpen open={exportOpen}>
          <ExportDialog />
        </OnFirstOpen>
        <OnFirstOpen open={savedViewsOpen}>
          <SavedViewsDialog />
        </OnFirstOpen>
        <ConfirmHost />
        <PromptHost />
      </div>
    )
  }

  return (
    <div className="app">
      <TopBar />
      <ErrorBar />
      <UpdateBar />
      <TabsBar />
      <BackupBar />
      <div className={`workspace ${leftOpen ? 'has-left' : ''} ${rightOpen ? 'has-right' : ''}`}>
        {narrow && (leftOpen || rightOpen) && (
          <div
            className="workspace__backdrop"
            data-testid="panel-backdrop"
            onClick={() => {
              useUi.getState().closePanels()
            }}
          />
        )}
        {leftOpen && (
          <div className="workspace__left">
            <ProcessTree />
          </div>
        )}
        <main className="workspace__main" id="main">
          <ErrorBoundary
            resetKey={view}
            fallback={(error, reset) => <ViewCrash error={error} reset={reset} />}
          >
            <Suspense fallback={<div className="loading">Ladataan…</div>}>
              {view === 'canvas' ? (
                <Canvas />
              ) : view === 'list' ? (
                <ListView />
              ) : view === 'analysis' ? (
                <AnalysisView />
              ) : view === 'compare' ? (
                <CompareView />
              ) : (
                <SourcesView />
              )}
            </Suspense>
          </ErrorBoundary>
        </main>
        {rightOpen && (
          <div className="workspace__right">
            <RightPanel />
          </div>
        )}
      </div>
      <OnFirstOpen open={entityManagerOpen}>
        <EntityManager />
      </OnFirstOpen>
      <OnFirstOpen open={storageOpen}>
        <StorageDialog />
      </OnFirstOpen>
      <OnFirstOpen open={replaceOpen}>
        <ReplaceDialog />
      </OnFirstOpen>
      <OnFirstOpen open={helpOpen}>
        <HelpDialog />
      </OnFirstOpen>
      <OnFirstOpen open={syncOpen}>
        <SyncDialog />
      </OnFirstOpen>
      <OnFirstOpen open={cardOpen}>
        <ProcessCardDialog />
      </OnFirstOpen>
      <OnFirstOpen open={versionsOpen}>
        <VersionsDialog />
      </OnFirstOpen>
      <OnFirstOpen open={importOpen}>
        <ImportDialog />
      </OnFirstOpen>
      <OnFirstOpen open={savedViewsOpen}>
        <SavedViewsDialog />
      </OnFirstOpen>
      <OnFirstOpen open={exportOpen}>
        <ExportDialog />
      </OnFirstOpen>
      <OnFirstOpen open={quickOpen}>
        <QuickInput />
      </OnFirstOpen>
      <ConfirmHost />
      <PromptHost />
    </div>
  )
}

export default App
