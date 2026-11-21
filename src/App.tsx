import { useEffect } from 'react'
import { Canvas } from './canvas/Canvas'
import { EntityManager } from './panels/EntityManager'
import { ExportDialog } from './panels/ExportDialog'
import { PresentView } from './panels/PresentView'
import { CompareView } from './panels/CompareView'
import { SavedViewsDialog } from './panels/SavedViewsDialog'
import { VersionsDialog } from './panels/VersionsDialog'
import { AnalysisView } from './panels/AnalysisView'
import { ImportDialog } from './panels/ImportDialog'
import { HelpDialog } from './panels/HelpDialog'
import { ListView } from './panels/ListView'
import { ProcessTree } from './panels/ProcessTree'
import { SourcesView } from './panels/SourcesView'
import { QuickInput } from './panels/QuickInput'
import { ReplaceDialog } from './panels/ReplaceDialog'
import { RightPanel } from './panels/RightPanel'
import { StorageDialog } from './panels/StorageDialog'
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
import './app.css'

function App() {
  const ready = useStore((s) => s.ready)
  const view = useUi((s) => s.view)
  const leftOpen = useUi((s) => s.leftOpen)
  const rightOpen = useUi((s) => s.rightOpen)
  const presenting = useUi((s) => s.presenting)
  useShortcuts()

  useEffect(() => {
    void useStore.getState().init()
  }, [])

  if (!ready) return <div className="loading">Ladataan…</div>

  if (presenting) {
    return (
      <div className="app app--present">
        <PresentView />
        <ExportDialog />
        <SavedViewsDialog />
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
          </ErrorBoundary>
        </main>
        {rightOpen && (
          <div className="workspace__right">
            <RightPanel />
          </div>
        )}
      </div>
      <EntityManager />
      <StorageDialog />
      <ReplaceDialog />
      <HelpDialog />
      <VersionsDialog />
      <ImportDialog />
      <SavedViewsDialog />
      <ExportDialog />
      <QuickInput />
      <ConfirmHost />
      <PromptHost />
    </div>
  )
}

export default App
